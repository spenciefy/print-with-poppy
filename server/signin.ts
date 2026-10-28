import type { Express, Request, Response } from "express";
import type { Session } from "./types.js";
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
import { get, put, id, hash, HttpError } from "./store.js";
import { orderView } from "./commerce.js";
import { savedAddresses, addressView } from "./addresses.js";
import { photosAvailable } from "./photos.js";
import {
  agentIdentity,
  loadFlow,
  page,
  renderSignIn,
  consentPolicy,
  pageErrors,
  type BrowserFlow,
} from "./signin-pages.js";

const base = "/oauth/authorize";
const render = (flow: BrowserFlow, res: Response, error = "") =>
  renderSignIn(flow, res, base, error);
const browserFlow = (req: Request) => loadFlow(req, "direct", "poppy_signin");
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
    // Missing, unknown or unavailable scopes are invalid_scope (spec 4.4, 4.7).
    const requested = scopes(req.body?.scope);
    const b = z
      .object({
        scope: z.string(),
        credentials: z.object({ email: z.email().max(254) }).strict(),
      })
      .strict()
      .parse(req.body);
    // A Session can only ever be signed in to one account: refuse early, before
    // sending a code, when these credentials are for another account (spec 4.4).
    const bound = get<Session>("session", session.id)?.accountBinding;
    if (bound) {
      const existing = get(
        "account-email",
        hash(b.credentials.email.trim().toLowerCase()),
      );
      if (existing?.id !== bound)
        throw new HttpError(
          400,
          "account_mismatch",
          "This session was signed in to a different account. Start a new session.",
        );
    }
    res.json(
      await startCode(session.id, b.credentials.email, requested, session.clientId),
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
    const addresses = savedAddresses(accountId);
    res.json({
      email: account.email,
      scope: session.scopes!.join(" "),
      saved_addresses: addresses.length,
      default_address: addresses.find((a) => a.default)
        ? addressView(addresses.find((a) => a.default)!)
        : null,
    });
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
        // reorderOrder (poppy:write) proposes the same items again, for approval.
        reorderable: photosAvailable(o.quote.items.map((i) => i.photoId)),
      })),
      next_cursor: result.next,
    });
  });
  app.get("/oauth/authorize", async (req, res) => {
    const q = req.query as Record<string, unknown>;
    // Until client_id and redirect_uri are verified, errors are shown here and
    // never redirected (RFC 6749 §4.1.2.1). Repeated parameters arrive as arrays.
    if (typeof q.client_id !== "string" || typeof q.redirect_uri !== "string")
      throw new HttpError(
        400,
        "invalid_request",
        "client_id and redirect_uri are required, once each.",
      );
    const c = await client(q.client_id);
    if (!c.metadata.redirect_uris?.includes(q.redirect_uri))
      throw new HttpError(
        400,
        "invalid_request",
        "The agent callback URL is not registered.",
      );
    const redirectUri = q.redirect_uri;
    const state = typeof q.state === "string" ? q.state : undefined;
    // Other errors go back to the agent with state and iss (RFC 9207).
    const fail = (error: string, description: string) => {
      const destination = new URL(redirectUri);
      destination.searchParams.set("error", error);
      destination.searchParams.set("error_description", description);
      if (state && state.length <= 2048) destination.searchParams.set("state", state);
      destination.searchParams.set("iss", config.origin);
      res.redirect(302, destination.href);
    };
    if (q.response_type !== "code")
      return fail("unsupported_response_type", "Use response_type=code.");
    if (!state || state.length > 2048)
      return fail("invalid_request", "A random state value is required.");
    if (
      q.code_challenge_method !== "S256" ||
      typeof q.code_challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)
    )
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
    let requested: string[];
    try {
      requested = scopes(q.scope);
    } catch {
      return fail("invalid_scope", "Request poppy:read and/or poppy:write.");
    }
    const { name, logo } = agentIdentity(q.client_id, c.metadata);
    const browser = id("browser"),
      flow: BrowserFlow = {
        id: id("flow"),
        kind: "direct",
        csrf: id("csrf"),
        browserHash: hash(browser),
        clientId: q.client_id,
        name,
        logo,
        redirectUri,
        state,
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
    const result = await pageErrors(
      res,
      (message) => render(flow, res, message),
      () => startCode(`browser:${flow.id}`, email, flow.scopes, flow.clientId),
    );
    if (!result) return;
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
        consentPolicy(res);
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
    const destination = new URL(flow.redirectUri!);
    destination.searchParams.set("state", flow.state!);
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
        render(flow, res, "Choose at least one permission, or deny.");
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
      throw new HttpError(400, "invalid_request", "Choose allow or deny.");
    flow.used = true;
    put("browser-signin", flow.id, flow);
    res.clearCookie("poppy_signin", { path: "/oauth" });
    res.redirect(303, destination.href);
  });
}
