import { DurableObject } from "cloudflare:workers";
import { configuration, withRuntime, type Env } from "./context.js";
import { sqlite } from "./sqlite.js";
import { withDatabase } from "../server/storage-runtime.js";
import { initializeStore } from "../server/store-schema.js";
import { registerRoutes } from "../server/routes.js";
import { router, pass } from "./router.js";
import { runJob } from "../server/job-actions.js";
import { housekeeping } from "../server/retention.js";
import { get, put, all, id, HttpError, hash } from "../server/store.js";
import { authenticate } from "../server/auth.js";
import { photoView } from "../server/photos.js";
import type { Photo } from "../server/types.js";

export class CommerceState extends DurableObject<Env> {
  private routes?: ReturnType<typeof router>;
  private ready: Promise<void>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const db = sqlite(ctx.storage);
      initializeStore(db);
      db.exec(`CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, published INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER IF NOT EXISTS job_outbox AFTER INSERT ON jobs BEGIN INSERT OR IGNORE INTO outbox(id) VALUES(NEW.id); END;
        CREATE TABLE IF NOT EXISTS rate_limits(id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_at);`);
      await this.inContext(async () => {
        this.routes = router();
        await registerRoutes(this.routes.facade, pass, pass, pass);
      });
      await ctx.storage.setAlarm(Date.now() + 60000);
    });
  }
  private async scheduleSoon() {
    const next = Date.now() + 1000;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next)
      await this.ctx.storage.setAlarm(next);
  }
  private inContext<T>(fn: () => T, fence: () => void = () => {}) {
    return withRuntime(
      {
        env: this.env,
        config: configuration(this.env),
        kick: async () => {
          await this.scheduleSoon();
        },
      },
      () => withDatabase(sqlite(this.ctx.storage, fence), fn),
    );
  }
  private rate(request: Request) {
    const path = new URL(request.url).pathname;
    const limit = path.startsWith("/oauth")
      ? 30
      : path === "/api/agent-sessions"
        ? 10
        : 180;
    const window = path === "/api/agent-sessions" ? 3600000 : 60000;
    const now = Date.now(),
      key = hash(
        `${request.headers.get("CF-Connecting-IP") || "local"}:${path.startsWith("/oauth") ? "oauth" : path === "/api/agent-sessions" ? "compat" : "api"}:${Math.floor(now / window)}`,
      );
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM rate_limits WHERE expires<?", now);
    const row = sql
      .exec<{ count: number }>(
        "INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count",
        key,
        now + window,
      )
      .one();
    if (row.count > limit)
      throw new HttpError(
        429,
        "rate_limited",
        "Too many requests. Retry later.",
      );
  }
  async fetch(request: Request) {
    await this.ready;
    return this.inContext(async () => {
      try {
        this.rate(request);
        const response = await this.routes!.app.fetch(request);
        // Alarm already exists before a mutation is acknowledged; outbox delivery is recoverable.
        await this.scheduleSoon();
        return response;
      } catch (e) {
        return this.error(e);
      }
    });
  }
  private error(e: unknown) {
    if (e instanceof HttpError) {
      const headers: Record<string, string> = {};
      if (e.status === 429) headers["Retry-After"] = "60";
      if (
        e.status === 401 ||
        [
          "sign_in_required",
          "insufficient_scope",
          "extension_required",
        ].includes(e.code)
      )
        headers["WWW-Authenticate"] = `DPoP error="${e.code}"`;
      return Response.json(
        {
          error: e.code,
          error_description: e.message,
          message: e.message,
          ...e.extra,
        },
        { status: e.status, headers },
      );
    }
    console.error(
      "Commerce request failed",
      e instanceof Error ? e.name : "Error",
    );
    return Response.json(
      { error: "internal_error", message: "Retry the same request." },
      { status: 500 },
    );
  }
  async beginUpload(request: Request) {
    await this.ready;
    return this.inContext(async () => {
      try {
        this.rate(request);
        const headers = request.headers;
        const session = await authenticate({
          get: (key: string) => headers.get(key) || undefined,
          rawHeaders: [...headers.entries()].flat(),
          method: request.method,
          originalUrl: new URL(request.url).pathname,
        } as any);
        const now = Date.now();
        const pending = all<any>("upload", session.id).filter(
          (p) => p.expires > now && !p.done,
        );
        if (
          all<Photo>("photo", session.id).filter((p) => !p.deleted).length +
            pending.length >=
          100
        )
          throw new HttpError(
            429,
            "photo_limit",
            "Maximum 100 stored photos per session.",
          );
        const ticket = {
          id: id("photo"),
          owner: session.id,
          token: id("upload"),
          expires: now + 120000,
        };
        put("upload", ticket.id, ticket, session.id);
        return Response.json(ticket);
      } catch (e) {
        return this.error(e);
      }
    });
  }
  async finishUpload(
    ticket: { id: string; token: string },
    dimensions: { width: number; height: number },
  ) {
    await this.ready;
    return this.inContext(() => {
      const pending = get("upload", ticket.id);
      if (
        !pending ||
        pending.token !== ticket.token ||
        pending.expires < Date.now()
      )
        throw new Error("Upload reservation expired.");
      if (pending.done) return photoView(get<Photo>("photo", ticket.id)!);
      const { width, height } = dimensions;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        Math.min(width, height) < 300 ||
        Math.max(width, height) > 6000
      )
        throw new Error("Invalid image dimensions.");
      const photo: Photo = {
        id: ticket.id,
        owner: pending.owner,
        name: `Photo ${all<Photo>("photo", pending.owner).length + 1}`,
        width,
        height,
        lowResolution:
          Math.min(width, height) < 1200 || Math.max(width, height) < 1800,
        created: Date.now(),
      };
      this.ctx.storage.transactionSync(() => {
        put("photo", photo.id, photo, photo.owner);
        put("upload", photo.id, { ...pending, done: true }, photo.owner);
      });
      return photoView(photo);
    });
  }
  async reconcile() {
    await this.ready;
    const now = Date.now();
    // Pending rows are the durable outbox. Re-publish after lost queue acknowledgments.
    const rows = this.ctx.storage.sql
      .exec<{ id: string }>(
        `SELECT j.id FROM jobs j LEFT JOIN outbox o ON j.id=o.id LEFT JOIN leases l ON j.id=l.id
      WHERE j.state='pending' AND j.next_at<=? AND (l.id IS NULL OR l.expires<=?) AND (o.id IS NULL OR o.published<?) ORDER BY j.rowid LIMIT 50`,
        now,
        now,
        now - 60000,
      )
      .toArray();
    for (const row of rows) {
      await this.env.JOBS.send({ id: row.id });
      this.ctx.storage.sql.exec(
        "INSERT INTO outbox(id,published) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET published=excluded.published",
        row.id,
        now,
      );
    }
  }
  async execute(jobId: string) {
    await this.ready;
    const sql = this.ctx.storage.sql,
      now = Date.now(),
      token = crypto.randomUUID();
    const job = this.ctx.storage.transactionSync(() => {
      const job = sql
        .exec<any>(
          "SELECT id,kind,record_id,attempts FROM jobs WHERE id=? AND state='pending' AND next_at<=?",
          jobId,
          now,
        )
        .toArray()[0];
      if (!job) return null;
      const lease = sql
        .exec<any>("SELECT expires FROM leases WHERE id=?", jobId)
        .toArray()[0];
      if (lease?.expires > now) return null;
      sql.exec(
        "INSERT INTO leases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires",
        jobId,
        token,
        now + 120000,
      );
      return job;
    });
    if (!job) return;
    const fence = () => {
      const current = sql
        .exec<any>("SELECT token,expires FROM leases WHERE id=?", jobId)
        .one();
      if (current.token !== token || current.expires <= Date.now())
        throw new Error("Job lease lost.");
    };
    try {
      await this.inContext(() => runJob(job), fence);
      fence();
      sql.exec("UPDATE jobs SET state='done',error=NULL WHERE id=?", jobId);
    } catch (e) {
      // Do not write a stale attempt over a newer lease holder.
      try {
        fence();
      } catch {
        return;
      }
      const terminal = ["pricing_unavailable", "fulfillment_rejected"].includes(
        (e as any)?.code,
      );
      sql.exec(
        "UPDATE jobs SET state=?,attempts=attempts+1,next_at=?,error=? WHERE id=?",
        terminal ? "failed" : "pending",
        Date.now() +
          Math.min(3600000, 1000 * 2 ** Math.min(job.attempts + 1, 12)),
        e instanceof Error ? e.message : "Job failed",
        jobId,
      );
      console.error("Job needs retry", { jobId, kind: job.kind, terminal });
    } finally {
      sql.exec("DELETE FROM leases WHERE id=? AND token=?", jobId, token);
      await this.scheduleSoon();
    }
  }
  private async collectOrphans() {
    const cursor = await this.ctx.storage.get<string>("media-gc-cursor");
    const page = await this.env.PHOTOS.list({
      prefix: "staged/",
      limit: 50,
      cursor,
    });
    for (const item of page.objects) {
      if (item.uploaded.getTime() > Date.now() - 86400000) continue;
      const [, photoId, , name] = item.key.split("/");
      const pointerName = `photos/${photoId}/${name}.json`;
      const pointer = await this.env.PHOTOS.get(pointerName);
      const current = pointer ? await pointer.json<{ key: string }>() : null;
      const exists =
        this.ctx.storage.sql
          .exec("SELECT id FROM records WHERE kind='photo' AND id=?", photoId)
          .toArray().length > 0;
      if (current?.key !== item.key || !exists) {
        await this.env.PHOTOS.delete(item.key);
        if (current?.key === item.key && !exists)
          await this.env.PHOTOS.delete(pointerName);
      }
    }
    if (page.truncated)
      await this.ctx.storage.put("media-gc-cursor", page.cursor);
    else await this.ctx.storage.delete("media-gc-cursor");
    this.ctx.storage.sql.exec(
      "DELETE FROM records WHERE kind='upload' AND json_extract(body,'$.expires')<?",
      Date.now() - 86400000,
    );
  }
  async alarm() {
    // Install the next alarm before remote I/O, including failed queue publication.
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    await this.ready;
    await this.inContext(() => housekeeping());
    await this.reconcile();
    await this.collectOrphans();
  }
}
