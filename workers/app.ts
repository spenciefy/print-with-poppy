import { batchBodyLimit, parsePhotoBatch, processPhotoBatch } from "../server/batch-photos.js";
import { configuration, withRuntime, type Env } from "./context.js";
import { media } from "./adapters/media-runtime.js";
import { samplePhotos } from "../server/sample-photos.js";
import { sign, equal, HttpError } from "../server/store.js";
import { errorResponse } from "../server/http-errors.js";
import { shirtMediaVariants } from "../src/offer.js";
export { CommerceState } from "./commerce-state.js";
export { MediaContainer, ProtocolContainer } from "./containers.js";
const commerce = (env: Env) =>
  env.COMMERCE.get(env.COMMERCE.idFromName("commerce-v1")) as any;
async function batchPhotoRequest(request: Request, env: Env) {
  const files = await parsePhotoBatch(await boundedBody(request, batchBodyLimit), request.headers.get("Content-Type") || "");
  const state = commerce(env);
  const authorization = await state.beginUpload(new Request(request.url, {
    method: request.method, headers: request.headers,
  }), files.length);
  if (!authorization.ok) return authorization;
  const value = await authorization.json();
  const tickets = Array.isArray(value) ? value : [value];
  return Response.json(await processPhotoBatch(files, async (file, index) => {
    const ticket = tickets[index];
    try {
      const { width, height, files: normalized } = await media.normalize(Buffer.from(await file.arrayBuffer()));
      await media.write(ticket.id, normalized);
      return await state.finishUpload(ticket, { width, height });
    } catch (error) {
      // Do not let reservation cleanup mask the actual per-photo failure.
      await state.releaseUpload(ticket).catch(() => console.error("Batch upload reservation cleanup failed"));
      throw error;
    }
  }));
}
async function photoRequest(request: Request, env: Env) {
  const state = commerce(env);
  const authorization = await state.beginUpload(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
    }),
  );
  if (!authorization.ok) return authorization;
  const ticket = (await authorization.json()) as any;
  const sample = new URL(request.url).pathname.endsWith("/samples");
  let buffer: Buffer, sampleColor: string | undefined;
  if (sample) {
    const text = await boundedBody(request, 131072);
    let body: any;
    try {
      body = JSON.parse(text.toString());
    } catch {
      throw new HttpError(400, "invalid_request", "Send a valid JSON object.");
    }
    const artwork = samplePhotos.find((p) => p.color === body?.color);
    if (!artwork || Object.keys(body).length !== 1)
      throw new HttpError(
        400,
        "invalid_request",
        "Choose yellow, orange, or red.",
      );
    buffer = await media.sample(artwork.url);
    sampleColor = artwork.color;
  } else {
    const bytes = await boundedBody(request, 20 * 1024 * 1024 + 65536);
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": request.headers.get("Content-Type") || "" },
    }).formData();
    const entries = [...form.entries()];
    if (
      entries.length !== 1 ||
      entries[0][0] !== "photo" ||
      typeof entries[0][1] === "string"
    )
      throw new HttpError(
        400,
        "photo_required",
        "Attach one photo in the photo field.",
      );
    const file = entries[0][1];
    if (file.size > 20 * 1024 * 1024)
      throw new HttpError(
        413,
        "upload_limit",
        "Upload one photo, up to 20 MB.",
      );
    buffer = Buffer.from(await file.arrayBuffer());
  }
  const { width, height, files } = await media.normalize(buffer);
  await media.write(ticket.id, files);
  const photo = await state.finishUpload(ticket, { width, height });
  return Response.json(
    { ...photo, ...(sampleColor ? { sampleColor } : {}) },
    { status: 201 },
  );
}
async function boundedBody(request: Request, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader)
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(
          413,
          "request_too_large",
          "Request body exceeds the size limit.",
        );
      }
      chunks.push(part.value);
    }
  return Buffer.concat(chunks);
}
async function serveMedia(request: Request, env: Env) {
  const url = new URL(request.url),
    parts = url.pathname.split("/"),
    id = parts[2],
    variant = parts[3],
    exp = url.searchParams.get("exp") || "",
    signature = url.searchParams.get("sig") || "";
  if (
    parts.length !== 4 ||
    !/^photo_[A-Za-z0-9_-]+$/.test(id) ||
    ![
      ...shirtMediaVariants,
      "contain",
      "cover",
      "poster-contain",
      "poster-cover",
      "square-contain",
      "square-cover",
      "enlargement-contain",
      "enlargement-cover",
      "mug-cover",
      "mug-contain",
    ].includes(variant) ||
    !/^\d+$/.test(exp) ||
    Number(exp) < Date.now() / 1000 ||
    !equal(signature, sign(`${id}:${variant}:${exp}`))
  )
    throw new HttpError(403, "invalid_link", "Preview link has expired.");
  const name = `${variant}.${/^tshirt-(contain|cover)$/.test(variant) ? "png" : "jpg"}`;
  const pointer = await env.PHOTOS.get(`photos/${id}/${name}.json`);
  if (!pointer)
    throw new HttpError(410, "photo_expired", "This photo has been deleted.");
  const { key } = await pointer.json<{ key: string }>();
  const image = await env.PHOTOS.get(key);
  if (!image)
    throw new HttpError(410, "photo_expired", "This photo has been deleted.");
  return new Response(image.body, {
    headers: {
      "Content-Type": name.endsWith(".png") ? "image/png" : "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = configuration(env);
    return withRuntime({ env, config, kick: async () => {} }, async () => {
      const path = new URL(request.url).pathname;
      let response: Response;
      try {
        if (request.method === "POST" && path === "/api/photos/batch")
          response = await batchPhotoRequest(request, env);
        else if (
          request.method === "POST" &&
          ["/api/photos", "/api/photos/samples"].includes(path)
        )
          response = await photoRequest(request, env);
        else if (path === "/api/config") {
          const result = await commerce(env).fetch(request);
          response = Response.json(
            {
              ...(await result.json()),
              hosting: "cloudflare",
              liveOrdersEnabled:
                env.CF_DEPLOYMENT === "production"
                  ? env.LIVE_ORDERS_ENABLED === "true"
                  : false,
              restrictedLaunch: !!env.ORDER_EMAIL_ALLOWLIST,
            },
            { status: result.status },
          );
        } else if (path.startsWith("/media/"))
          response = await serveMedia(request, env);
        else if (
          /^\/(api|oauth|device)(\/|$)/.test(path) ||
          path.startsWith("/.well-known/") ||
          ["/openapi.json", "/agent.txt", "/sandbox"].includes(path)
        )
          response = await commerce(env).fetch(request);
        else {
          response = await env.ASSETS.fetch(request);
          // Social crawlers must fetch preview assets from this isolated deployment.
          if (response.headers.get("content-type")?.includes("text/html")) {
            response = new HTMLRewriter().on('meta[content]', {
              element(element) {
                const value = element.getAttribute("content");
                if (value?.startsWith("https://printwithpoppy.com/poppy-social-"))
                  element.setAttribute("content", value.replace("https://printwithpoppy.com", config.origin));
              },
            }).transform(response);
          }
        }
      } catch (e) {
        response =
          e instanceof HttpError
            ? (() => {
                const { status, headers, body } = errorResponse(e);
                return Response.json(body, { status, headers });
              })()
            : Response.json(
                { error: "internal_error", message: "Retry the same request." },
                { status: 500 },
              );
        if (!(e instanceof HttpError))
          console.error(
            "Worker request failed",
            path,
            e instanceof Error ? e.name : "Error",
          );
      }
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      // Browser sign-in uses same-origin so form POSTs retain their Origin.
      // Keep route-specific policy; other responses default to no-referrer.
      if (!headers.has("Referrer-Policy"))
        headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Frame-Options", "DENY");
      // Sign-in pages add only the requesting agent's logo origin to img-src.
      if (!/^\/(oauth\/authorize|device)(\/|$)/.test(path) || !headers.has("Content-Security-Policy"))
        headers.set(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; script-src 'self'; frame-ancestors 'none'",
      );
      if (/^\/(api|oauth|device|media|order)(\/|$)/.test(path))
        headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    });
  },
  async queue(batch: MessageBatch<{ id: string }>, env: Env) {
    for (const message of batch.messages) {
      try {
        await commerce(env).execute(message.body.id);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env) {
    await commerce(env).reconcile();
  },
};
