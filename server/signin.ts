import type { Express, Request, Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { authenticate, client } from "./auth.js";
import {
  scopes,
  startCode,
  verifyCode,
  signIn,
  requireAccount,
  history,
} from "./accounts.js";
import { get, put, id, hash, equal, HttpError } from "./store.js";
import { escapeHtml as esc } from "./email.js";
import { orderView } from "./commerce.js";

const scopeText = (scope: string) =>
  scope === "poppy:read"
    ? "View your order history and delivery details"
    : "Save new orders to your account (each purchase still needs approval)";
function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Print with Poppy</title><style> *{box-sizing:border-box}body{margin:0;background:#faf6ee;color:#30291f;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:500px;padding:36px 24px;margin:6vh auto}header{display:flex;align-items:center;gap:12px;margin-bottom:38px;font-size:21px;font-weight:600}header img{width:64px;height:64px}h1{font-size:30px;line-height:1.2;letter-spacing:-1px}p{color:#6e6155}label{display:block;margin:18px 0}input[type=email],input[type=text]{width:100%;border:1px solid #b9ac9a;border-radius:8px;padding:14px;background:white;font:inherit}input[type=checkbox]{width:18px;height:18px;margin-right:8px;accent-color:#c34408}button{width:100%;padding:14px;border:0;border-radius:8px;background:#c34408;color:white;font:inherit;font-weight:600;cursor:pointer;margin:8px 0}button.secondary{background:transparent;color:#6e6155;border:1px solid #cfc3b3}small{color:#6e6155}a{color:#a53d0d}.agent{overflow-wrap:anywhere;padding:16px;background:#f7ebdf;border-radius:8px}.error{color:#a02b13}</style></head><body><main><header><img src="/photos/poppy-email-logo.png" alt=""><span>Print with Poppy</span></header><h1>${esc(title)}</h1>${content}</main></body></html>`;
}
function hidden(flow: any) {
  return `<input type="hidden" name="flow" value="${esc(flow.id)}"><input type="hidden" name="csrf" value="${esc(flow.csrf)}">`;
}
function render(flow: any, res: Response, error = "") {
  const agent = `<div class="agent"><strong>${esc(flow.name)}</strong><br><small>${esc(new URL(flow.clientId).hostname)}</small></div>`;
  if (flow.accountId) {
    res
      .type("html")
      .send(
        page(
          "Connect your personal agent",
          `${agent}<p>Signed in as ${esc(get("account", flow.accountId).email)}. Choose what this agent can access.</p>${error ? `<p role="alert" class="error">${esc(error)}</p>` : ""}<form method="post" action="/oauth/authorize/approve">${hidden(flow)}${flow.scopes.map((s: string) => `<label><input type="checkbox" name="scopes" value="${s}" checked>${scopeText(s)}</label>`).join("")}<button name="decision" value="approve">Allow access</button><button class="secondary" name="decision" value="deny">Cancel</button></form><small>This does not approve a purchase. Your agent can disconnect at any time.</small>`,
        ),
      );
  } else if (flow.challengeId) {
    res
      .type("html")
      .send(
        page(
          "Check your email",
          `${agent}<p>Enter the six-digit code sent to ${esc(flow.email)}.</p>${error ? `<p role="alert" class="error">${esc(error)}</p>` : ""}<form method="post" action="/oauth/authorize/verify">${hidden(flow)}<label for="code">Email code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button>Continue</button></form><small>The code expires in 10 minutes. You’ll review access next.</small>`,
        ),
      );
  } else {
    res
      .type("html")
      .send(
        page(
          "Sign in with your email",
          `${agent}<p>Connect your Print with Poppy account to this agent. We’ll email you a code—no password needed.</p><form method="post" action="/oauth/authorize/email">${hidden(flow)}<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required><button>Send code</button></form><small>New here? Verifying your email creates your account.</small>`,
        ),
      );
  }
}
function browserFlow(req: Request) {
  const f =
    typeof req.body.flow === "string" && get("browser-signin", req.body.flow);
  const cookie = (req.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("poppy_signin="))
    ?.slice("poppy_signin=".length);
  if (
    !f ||
    f.used ||
    f.expires <= Date.now() ||
    !cookie ||
    !equal(hash(cookie), f.browserHash) ||
    typeof req.body.csrf !== "string" ||
    !equal(req.body.csrf, f.csrf) ||
    req.get("Origin") !== config.origin
  )
    throw new HttpError(
      403,
      "invalid_request",
      "Sign-in expired. Start again from your personal agent.",
    );
  return f;
}
export function accountRoutes(app: Express) {
  // Keep same-origin form Origin headers while suppressing referrers to agent callbacks.
  app.use("/oauth/authorize", (_req, res, next) => {
    res.set("Referrer-Policy", "same-origin");
    next();
  });
  app.post("/api/poppy/sign-in", async (req, res) => {
    const session = await authenticate(req);
    if (session.compatibility || session.demo || !session.proofThumb)
      throw new HttpError(
        403,
        "native_session_required",
        "Use a native Poppy session to sign in.",
      );
    const b = z
      .object({
        scope: z.string(),
        credentials: z.object({ email: z.email().max(254) }).strict(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await startCode(
        session.id,
        b.credentials.email,
        scopes(b.scope),
        session.clientId,
      ),
    );
  });
  app.post("/api/poppy/sign-in/:id", async (req, res) => {
    const session = await authenticate(req);
    if (session.compatibility || session.demo || !session.proofThumb)
      throw new HttpError(
        403,
        "native_session_required",
        "Use a native Poppy session to sign in.",
      );
    const b = z
      .object({ code: z.string().max(32) })
      .strict()
      .parse(req.body);
    const result = verifyCode(session.id, String(req.params.id), b.code);
    if (result.status !== "verified") {
      res.json(result);
      return;
    }
    res.json({
      status: "complete",
      ...signIn(session, result.accountId, result.scopes, session.proofThumb),
    });
  });
  app.get("/api/account", async (req, res) => {
    const session = await authenticate(req);
    const accountId = requireAccount(session);
    const account = get("account", accountId);
    res.json({ email: account.email, scope: session.scopes!.join(" ") });
  });
  app.get("/api/account/orders", async (req, res) => {
    const session = await authenticate(req);
    const b = z
      .object({ cursor: z.string().max(256).optional() })
      .strict()
      .parse(req.query);
    const result = history(session, b.cursor);
    res.json({
      orders: result.rows.map((o) => ({
        ...orderView(o),
        checkoutUrl: undefined,
      })),
      next_cursor: result.next,
    });
  });
  app.get("/oauth/authorize", async (req, res) => {
    const q = z
      .object({
        response_type: z.literal("code"),
        client_id: z.string().url(),
        redirect_uri: z.string().url(),
        scope: z.string(),
        state: z.string().min(1).max(2048),
        code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code_challenge_method: z.literal("S256"),
      })
      .parse(req.query);
    const c = await client(q.client_id);
    if (!c.metadata.redirect_uris?.includes(q.redirect_uri))
      throw new HttpError(
        400,
        "invalid_request",
        "The agent callback URL is not registered.",
      );
    const requested = scopes(q.scope);
    const browser = id("browser"),
      flow = {
        id: id("flow"),
        csrf: id("csrf"),
        browserHash: hash(browser),
        clientId: q.client_id,
        name: String(c.metadata.client_name || new URL(q.client_id).hostname),
        redirectUri: q.redirect_uri,
        state: q.state,
        challenge: q.code_challenge,
        scopes: requested,
        expires: Date.now() + 15 * 60000,
      };
    put("browser-signin", flow.id, flow);
    res.cookie("poppy_signin", browser, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/oauth",
      maxAge: 15 * 60000,
    });
    render(flow, res);
  });
  app.post("/oauth/authorize/email", async (req, res) => {
    const flow = browserFlow(req);
    if (flow.accountId || flow.challengeId)
      throw new HttpError(
        409,
        "invalid_request",
        "Continue the existing sign-in.",
      );
    const email = z.email().max(254).parse(req.body.email).trim().toLowerCase();
    const result = await startCode(
      `browser:${flow.id}`,
      email,
      flow.scopes,
      flow.clientId,
    );
    flow.email = email;
    flow.challengeId = result.sign_in_id;
    put("browser-signin", flow.id, flow);
    render(flow, res);
  });
  app.post("/oauth/authorize/verify", (req, res) => {
    const flow = browserFlow(req);
    if (!flow.challengeId || flow.accountId)
      throw new HttpError(409, "invalid_request", "Start sign-in again.");
    const result = verifyCode(
      `browser:${flow.id}`,
      flow.challengeId,
      req.body.code,
    );
    if (result.status !== "verified") {
      if (result.status === "failed" || result.status === "expired") {
        flow.used = true;
        put("browser-signin", flow.id, flow);
        res
          .status(400)
          .type("html")
          .send(
            page(
              "Start sign-in again",
              "<p>Your code expired or too many attempts were made. Return to your agent and request a new sign-in.</p>",
            ),
          );
      } else render(flow, res, "That code did not match. Try again.");
      return;
    }
    flow.accountId = result.accountId;
    put("browser-signin", flow.id, flow);
    render(flow, res);
  });
  app.post("/oauth/authorize/approve", (req, res) => {
    const flow = browserFlow(req);
    if (!flow.accountId)
      throw new HttpError(403, "sign_in_required", "Verify your email first.");
    const destination = new URL(flow.redirectUri);
    destination.searchParams.set("state", flow.state);
    destination.searchParams.set("iss", config.origin);
    if (req.body.decision === "deny")
      destination.searchParams.set("error", "access_denied");
    else if (req.body.decision === "approve") {
      const selected = Array.isArray(req.body.scopes)
        ? req.body.scopes
        : [req.body.scopes];
      if (
        !selected.length ||
        selected.some(
          (s: any) => typeof s !== "string" || !flow.scopes.includes(s),
        )
      ) {
        render(flow, res, "Choose at least one permission, or cancel.");
        return;
      }
      const code = id("code");
      put("authorization-code", hash(code), {
        clientId: flow.clientId,
        redirectUri: flow.redirectUri,
        challenge: flow.challenge,
        accountId: flow.accountId,
        scopes: [...new Set(selected)],
        expires: Date.now() + 120000,
      });
      destination.searchParams.set("code", code);
    } else
      throw new HttpError(400, "invalid_request", "Choose allow or cancel.");
    flow.used = true;
    put("browser-signin", flow.id, flow);
    res.clearCookie("poppy_signin", { path: "/oauth" });
    res.redirect(303, destination.href);
  });
}
