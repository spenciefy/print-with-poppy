// Device Sign-In (Poppy 0.2 §4.6): the OAuth 2.0 device authorization grant
// (RFC 8628). The agent shows the customer a link and a short code; the customer
// opens it on any device, signs in with an emailed code, and approves access.
import { randomInt } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { authenticateClient, authenticate } from "./auth.js";
import {
  accountScopes,
  scopes,
  signIn,
  startCode,
  verifyCode,
  throttle,
  syntheticEmail,
} from "./accounts.js";
import { db, get, put, id, hash, sign, HttpError } from "./store.js";
import type { Session } from "./types.js";
import {
  agentIdentity,
  agentCard,
  consentPolicy,
  errorLine,
  esc,
  loadFlow,
  page,
  renderSignIn,
  type BrowserFlow,
} from "./signin-pages.js";
import { client } from "./auth.js";

export const deviceLifetimeSeconds = 600;
export const deviceIntervalSeconds = 5;
const cookieName = "poppy_device";
const base = "/device";
// RFC 8628 §6.1: no vowels or easily confused characters; 20^8 ≈ 2.6e10 codes.
const alphabet = "BCDFGHJKLMNPQRSTVWXZ";

export interface DeviceGrant {
  clientId: string;
  name: string;
  logo?: string;
  scopes: string[];
  userCode: string; // HMAC of the normalized user code; the raw code is never stored.
  status: "pending" | "approved" | "denied" | "consumed";
  expires: number;
  interval: number;
  lastPoll?: number;
  sessionId?: string; // The Session that first polled; only it can redeem the code.
  challengeId?: string; // Latest email-code challenge from the verification page.
  accountId?: string;
  granted?: string[];
  created: number;
}

export const normalizeUserCode = (value: unknown) =>
  typeof value === "string"
    ? value.toUpperCase().replace(/[^A-Z]/g, "")
    : "";
const userCodeKey = (normalized: string) => sign(`device-user-code:${normalized}`);
const display = (normalized: string) =>
  `${normalized.slice(0, 4)}-${normalized.slice(4)}`;

function oauthError(code: string, message: string) {
  return new HttpError(400, code, message);
}

/** POST /oauth/device: start a Device Sign-In for an authenticated agent. */
export async function startDevice(body: any) {
  const c = await authenticateClient(body || {});
  // A Company limits how often one agent can start sign-ins; 429 + Retry-After.
  throttle(`device-start:${body.client_id}`, 30, 600000);
  throttle("device-start:all", 1000, 3600000);
  const requested = scopes(body.scope, accountScopes);
  const { name, logo } = agentIdentity(body.client_id, c.metadata);
  const deviceCode = id("dvc");
  let normalized = "";
  for (let attempt = 0; attempt < 10 && !normalized; attempt++) {
    const candidate = Array.from(
      { length: 8 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    const existing = get("device-user-code", userCodeKey(candidate));
    if (!existing || existing.expires <= Date.now()) normalized = candidate;
  }
  if (!normalized)
    throw new HttpError(503, "temporarily_unavailable", "Try again shortly.");
  const now = Date.now();
  const grantId = hash(deviceCode);
  const grant: DeviceGrant = {
    clientId: body.client_id,
    name,
    logo,
    scopes: requested,
    userCode: userCodeKey(normalized),
    status: "pending",
    expires: now + deviceLifetimeSeconds * 1000,
    interval: deviceIntervalSeconds,
    created: now,
  };
  db.transaction(() => {
    put("device-grant", grantId, grant);
    put("device-user-code", grant.userCode, {
      grantId,
      expires: grant.expires,
    });
  })();
  const userCode = display(normalized);
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${config.origin}${base}`,
    verification_uri_complete: `${config.origin}${base}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: deviceLifetimeSeconds,
    interval: deviceIntervalSeconds,
  };
}

type PollOutcome = { error: HttpError } | { result: any };

/**
 * Token endpoint, grant_type=urn:ietf:params:oauth:grant-type:device_code.
 * Client authentication and the DPoP proof are already verified by issueToken.
 */
export function pollDevice(b: any, thumb: string) {
  // Poll bookkeeping (interval, session binding, one-time use) must persist even
  // when the answer is an error, so errors are returned rather than thrown here.
  const outcome: PollOutcome = db.transaction((): PollOutcome => {
    const grantId = hash(typeof b.device_code === "string" ? b.device_code : "");
    const g = get<DeviceGrant>("device-grant", grantId);
    if (!g || g.clientId !== b.client_id)
      return { error: oauthError("invalid_grant", "Unknown device code.") };
    if (g.status === "consumed")
      return {
        error: oauthError("invalid_grant", "This device code was already used."),
      };
    const session =
      typeof b.session_id === "string"
        ? get<Session>("session", b.session_id)
        : undefined;
    if (
      !session ||
      session.clientId !== b.client_id ||
      session.compatibility ||
      session.demo
    )
      return {
        error: oauthError(
          "invalid_session",
          "An existing native Poppy session of this agent is required.",
        ),
      };
    // Bind the sign-in to the first Session that polls for it.
    if (g.sessionId && g.sessionId !== session.id)
      return {
        error: oauthError(
          "invalid_grant",
          "This device code belongs to another session.",
        ),
      };
    g.sessionId = session.id;
    const now = Date.now();
    const save = () => put("device-grant", grantId, g);
    if (g.expires <= now) {
      save();
      return {
        error: oauthError(
          "expired_token",
          "The sign-in request expired. Start a new one.",
        ),
      };
    }
    if (g.status === "denied") {
      save();
      return {
        error: oauthError("access_denied", "The customer declined access."),
      };
    }
    if (g.status === "pending") {
      // One second of grace for network jitter; RFC 8628 §3.5 adds 5 s per slow_down.
      const tooSoon =
        g.lastPoll !== undefined && now - g.lastPoll < (g.interval - 1) * 1000;
      g.lastPoll = now;
      if (tooSoon) {
        g.interval += 5;
        save();
        return {
          error: new HttpError(400, "slow_down", "Polling too quickly.", {
            interval: g.interval,
          }),
        };
      }
      save();
      return {
        error: oauthError(
          "authorization_pending",
          "Waiting for the customer to approve.",
        ),
      };
    }
    // Approved: one-time use from here on, whatever the result.
    g.status = "consumed";
    save();
    let granted: string[];
    try {
      granted =
        b.scope === undefined ? g.granted! : scopes(b.scope, g.granted!);
    } catch (e) {
      return { error: e as HttpError };
    }
    if (session.accountBinding && session.accountBinding !== g.accountId)
      return {
        error: oauthError(
          "account_mismatch",
          "Start a new session to use a different account.",
        ),
      };
    return { result: signIn(session, g.accountId!, granted, thumb) };
  })();
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}

/** Captured demo email for the active challenge of a pending device sign-in. */
export async function deviceSignInEmail(req: Request) {
  const session = await authenticate(req);
  const b = z
    .object({ device_code: z.string().min(1).max(256) })
    .strict()
    .parse(req.body);
  const g = get<DeviceGrant>("device-grant", hash(b.device_code));
  const challenge = g?.challengeId && get("signin-code", g.challengeId);
  if (
    !g ||
    g.clientId !== session.clientId ||
    (g.sessionId && g.sessionId !== session.id) ||
    g.status !== "pending" ||
    g.expires <= Date.now() ||
    !challenge ||
    challenge.used ||
    challenge.expires <= Date.now() ||
    !syntheticEmail(challenge.email)
  )
    throw new HttpError(
      404,
      "not_found",
      "No active device sign-in code for a synthetic account. Open the verification link and send a code first.",
    );
  return {
    simulated: true,
    delivered: false,
    email: get("demo-signin-email", challenge.id),
  };
}

function codeEntryPage(res: Response, prefill = "", error = "") {
  consentPolicy(res);
  res.type("html").send(
    page(
      "Connect a personal agent",
      `<p>Enter the code your personal agent is showing you. Make sure it’s the code on your own agent’s screen.</p>${errorLine(error)}<form method="post" action="${base}"><label for="user_code">Code</label><input id="user_code" class="code" name="user_code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" value="${esc(prefill)}" required autofocus><button>Continue</button></form><small>Opening this page doesn’t connect anything. You’ll sign in and choose what the agent can access next.</small>`,
    ),
  );
}

function matchIntro(flow: BrowserFlow) {
  return flow.userCode
    ? `<p>Code <span class="match">${esc(flow.userCode)}</span> — check it matches the one your agent shows.</p>`
    : "";
}

function finished(res: Response, flow: BrowserFlow, approved: boolean) {
  consentPolicy(res, flow.logo);
  res.clearCookie(cookieName, { path: base });
  res.type("html").send(
    page(
      approved ? "You’re connected" : "Request declined",
      `${agentCard(flow)}<p>${approved ? `Return to ${esc(flow.name)} to continue. It can now use the access you chose.` : `${esc(flow.name)} was not given access to your account.`}</p><small>You can close this page.</small>`,
    ),
  );
}

function activeGrant(flow: BrowserFlow) {
  const g = flow.grantId && get<DeviceGrant>("device-grant", flow.grantId);
  return g && g.status === "pending" && g.expires > Date.now() ? g : undefined;
}

function closed(res: Response) {
  consentPolicy(res);
  res
    .status(400)
    .type("html")
    .send(
      page(
        "Start again from your agent",
        "<p>This sign-in request has expired or was already completed. Ask your personal agent for a new code.</p>",
      ),
    );
}

export function deviceRoutes(app: Express) {
  // Same-origin keeps the form posts' Origin header; nothing leaks to other sites.
  app.use(base, (_req, res, next) => {
    res.set("Referrer-Policy", "same-origin");
    res.set("Cache-Control", "no-store");
    next();
  });
  app.post("/oauth/device", async (req, res) => {
    res.json(await startDevice(req.body));
  });
  app.get(base, (req, res) => {
    // Opening the link never approves (or even looks up) the request by itself.
    const prefill =
      typeof req.query.user_code === "string"
        ? req.query.user_code.slice(0, 12)
        : "";
    codeEntryPage(res, prefill);
  });
  app.post(base, async (req, res) => {
    if (req.get("Origin") !== config.origin)
      throw new HttpError(403, "invalid_request", "Open the link again.");
    const normalized = normalizeUserCode(req.body?.user_code);
    // Bound guessing: user codes are short by design (RFC 8628 §5.1).
    throttle("device-entry:all", 600, 3600000);
    const index =
      normalized.length === 8 && get("device-user-code", userCodeKey(normalized));
    const g =
      index && get<DeviceGrant>("device-grant", index.grantId);
    if (!g || g.status !== "pending" || g.expires <= Date.now()) {
      res.status(400);
      codeEntryPage(
        res,
        "",
        "That code isn’t valid or has expired. Check the code your agent shows, or ask it for a new one.",
      );
      return;
    }
    // The agent may have been removed from the allowlist since the request started.
    await client(g.clientId);
    const browser = id("browser");
    const flow: BrowserFlow = {
      id: id("flow"),
      kind: "device",
      csrf: id("csrf"),
      browserHash: hash(browser),
      clientId: g.clientId,
      name: g.name,
      logo: g.logo,
      scopes: g.scopes,
      grantId: index.grantId,
      userCode: display(normalized),
      expires: Math.min(g.expires, Date.now() + 15 * 60000),
    };
    put("browser-signin", flow.id, flow);
    res.cookie(cookieName, browser, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: base,
      maxAge: 15 * 60000,
    });
    renderSignIn(flow, res, base, "", matchIntro(flow));
  });
  app.post(`${base}/email`, async (req, res) => {
    const flow = loadFlow(req, "device", cookieName);
    if (!activeGrant(flow)) return closed(res);
    if (flow.accountId || flow.challengeId)
      throw new HttpError(409, "invalid_request", "Continue the existing sign-in.");
    const email = z.email().max(254).parse(req.body.email).trim().toLowerCase();
    const result = await startCode(
      `device:${flow.id}`,
      email,
      flow.scopes,
      flow.clientId,
    );
    flow.email = email;
    flow.challengeId = result.sign_in_id;
    put("browser-signin", flow.id, flow);
    const g = activeGrant(flow);
    if (g) put("device-grant", flow.grantId!, { ...g, challengeId: flow.challengeId });
    renderSignIn(flow, res, base, "", matchIntro(flow));
  });
  app.post(`${base}/verify`, (req, res) => {
    const flow = loadFlow(req, "device", cookieName);
    if (!activeGrant(flow)) return closed(res);
    if (!flow.challengeId || flow.accountId)
      throw new HttpError(409, "invalid_request", "Start sign-in again.");
    const result = verifyCode(`device:${flow.id}`, flow.challengeId, req.body.code);
    if (result.status !== "verified") {
      if (result.status === "failed" || result.status === "expired") {
        flow.used = true;
        put("browser-signin", flow.id, flow);
        return closed(res);
      }
      renderSignIn(flow, res, base, "That code did not match. Try again.", matchIntro(flow));
      return;
    }
    flow.accountId = result.accountId;
    put("browser-signin", flow.id, flow);
    renderSignIn(flow, res, base, "", matchIntro(flow));
  });
  app.post(`${base}/approve`, (req, res) => {
    const flow = loadFlow(req, "device", cookieName);
    if (!flow.accountId)
      throw new HttpError(403, "sign_in_required", "Verify your email first.");
    const decision = req.body.decision;
    let selected: string[] = [];
    if (decision === "approve") {
      selected = (Array.isArray(req.body.scopes) ? req.body.scopes : [req.body.scopes]).filter(
        (s: unknown) => s !== undefined,
      );
      if (
        !selected.length ||
        selected.some((s: any) => typeof s !== "string" || !flow.scopes.includes(s))
      ) {
        renderSignIn(flow, res, base, "Choose at least one permission, or deny.", matchIntro(flow));
        return;
      }
    } else if (decision !== "deny")
      throw new HttpError(400, "invalid_request", "Choose allow or deny.");
    const done = db.transaction(() => {
      const g = activeGrant(flow);
      if (!g) return false;
      put(
        "device-grant",
        flow.grantId!,
        decision === "approve"
          ? { ...g, status: "approved", accountId: flow.accountId, granted: [...new Set(selected)] }
          : { ...g, status: "denied" },
      );
      put("browser-signin", flow.id, { ...flow, used: true });
      return true;
    })();
    if (!done) return closed(res);
    finished(res, flow, decision === "approve");
  });
}
