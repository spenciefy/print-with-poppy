// Shared HTML for the store's browser sign-in pages (Direct Sign-In consent and
// the Device Sign-In verification page). Both show the requesting agent from its
// client metadata, sign the customer in with an emailed code, and ask for consent.
import type { Request, Response } from "express";
import { config } from "./config.js";
import { get, equal, hash, HttpError } from "./store.js";
import { escapeHtml as esc } from "./email.js";
import { demoSignInCode } from "./accounts.js";

export { esc };
export const scopeText = (scope: string) =>
  scope === "poppy:read"
    ? "View your order history, saved addresses and delivery details"
    : "Save new orders and shipping addresses to your account and propose reorders (each purchase still needs your approval)";

export interface BrowserFlow {
  id: string;
  kind?: "direct" | "device";
  csrf: string;
  browserHash: string;
  clientId: string;
  name: string;
  logo?: string;
  scopes: string[];
  expires: number;
  email?: string;
  challengeId?: string;
  accountId?: string;
  used?: boolean;
  // Direct Sign-In
  redirectUri?: string;
  state?: string;
  challenge?: string;
  // Device Sign-In
  grantId?: string;
  userCode?: string;
}

/** Name and logo from the agent's client metadata; the logo must be an HTTPS URL (or this origin). */
export function agentIdentity(clientId: string, metadata: any) {
  const name = String(
    (typeof metadata.client_name === "string" && metadata.client_name.trim()) ||
      new URL(clientId).hostname,
  ).slice(0, 120);
  let logo: string | undefined;
  if (typeof metadata.logo_uri === "string") {
    try {
      const u = new URL(metadata.logo_uri);
      if (u.protocol === "https:" || u.origin === config.origin) logo = u.href;
    } catch {
      logo = undefined;
    }
  }
  return { name, logo };
}

/**
 * The site CSP, plus the agent's logo origin in img-src and, for Direct Sign-In,
 * the agent's registered callback origin in form-action: browsers apply
 * form-action to the redirect that follows the consent form, so `'self'` alone
 * would block the redirect back to the agent.
 */
export function consentPolicy(res: Response, logo?: string, callback?: string) {
  const origin = (url?: string) =>
    url && new URL(url).origin !== config.origin ? ` ${new URL(url).origin}` : "";
  res.set(
    "Content-Security-Policy",
    `default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' blob: data:${origin(logo)}; form-action 'self'${origin(callback)}; frame-ancestors 'none'${config.origin.startsWith("https:") ? "; upgrade-insecure-requests" : ""}`,
  );
}

export function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Print with Poppy</title><style> *{box-sizing:border-box}body{margin:0;background:#faf6ee;color:#30291f;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:500px;padding:36px 24px;margin:6vh auto}header{display:flex;align-items:center;gap:12px;margin-bottom:38px;font-size:21px;font-weight:600}header img{width:64px;height:64px}h1{font-size:30px;line-height:1.2;letter-spacing:-1px}p{color:#6e6155}label{display:block;margin:18px 0}input[type=email],input[type=text]{width:100%;border:1px solid #b9ac9a;border-radius:8px;padding:14px;background:white;font:inherit}input.code{font-size:26px;letter-spacing:4px;text-transform:uppercase;text-align:center}input[type=checkbox]{width:18px;height:18px;margin-right:8px;accent-color:#c34408}button{width:100%;padding:14px;border:0;border-radius:8px;background:#c34408;color:white;font:inherit;font-weight:600;cursor:pointer;margin:8px 0}button.secondary{background:transparent;color:#6e6155;border:1px solid #cfc3b3}small{color:#6e6155}a{color:#a53d0d}.agent{display:flex;align-items:center;gap:14px;overflow-wrap:anywhere;padding:16px;background:#f7ebdf;border-radius:8px}.agent img{width:48px;height:48px;border-radius:10px;object-fit:cover;flex:none;background:white}.match{font-size:24px;letter-spacing:3px;font-weight:700;color:#30291f}.demo{border:1px dashed #c34408;border-radius:8px;padding:12px 16px;background:#fff7ef}.error{color:#a02b13}</style></head><body><main><header><img src="/photos/poppy-email-logo.png" alt=""><span>Print with Poppy</span></header><h1>${esc(title)}</h1>${content}</main></body></html>`;
}

export function agentCard(flow: Pick<BrowserFlow, "name" | "logo" | "clientId">) {
  const logo = flow.logo
    ? `<img src="${esc(flow.logo)}" alt="" referrerpolicy="no-referrer">`
    : "";
  return `<div class="agent">${logo}<div><strong>${esc(flow.name)}</strong><br><small>Personal agent at ${esc(new URL(flow.clientId).hostname)}</small></div></div>`;
}

export function hidden(flow: BrowserFlow) {
  return `<input type="hidden" name="flow" value="${esc(flow.id)}"><input type="hidden" name="csrf" value="${esc(flow.csrf)}">`;
}

/** Demo stores send no email. For synthetic accounts, show the captured code on the page. */
export function demoCodeNotice(flow: BrowserFlow) {
  const code = flow.challengeId && demoSignInCode(flow.challengeId);
  if (!code) return "";
  return `<p class="demo"><strong>${config.agentSandbox ? "Agent Sandbox" : "Demo store"}:</strong> no email was sent. Your captured code is <strong>${esc(code)}</strong>. Real stores email it.</p>`;
}

export const errorLine = (error: string) =>
  error ? `<p role="alert" class="error">${esc(error)}</p>` : "";

/** Sign-in steps shared by Direct and Device Sign-In: email, code, consent. */
export function renderSignIn(
  flow: BrowserFlow,
  res: Response,
  base: string,
  error = "",
  intro = "",
) {
  const agent = agentCard(flow);
  consentPolicy(res, flow.logo, flow.redirectUri);
  if (flow.accountId) {
    res.type("html").send(
      page(
        "Connect your personal agent",
        `${agent}${intro}<p>Signed in as ${esc(get("account", flow.accountId).email)}. Choose what this agent can access.</p>${errorLine(error)}<form method="post" action="${base}/approve">${hidden(flow)}${flow.scopes.map((s: string) => `<label><input type="checkbox" name="scopes" value="${esc(s)}" checked>${esc(scopeText(s))}</label>`).join("")}<button name="decision" value="approve">Allow access</button><button class="secondary" name="decision" value="deny">Deny</button></form><small>This does not approve a purchase. You can disconnect this agent at any time.</small>`,
      ),
    );
  } else if (flow.challengeId) {
    res.type("html").send(
      page(
        "Check your email",
        `${agent}${intro}<p>Enter the six-digit code sent to ${esc(flow.email || "your email")}.</p>${demoCodeNotice(flow)}${errorLine(error)}<form method="post" action="${base}/verify">${hidden(flow)}<label for="code">Email code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button>Continue</button></form><small>The code expires in 10 minutes. You’ll review access next.</small>`,
      ),
    );
  } else {
    res.type("html").send(
      page(
        "Sign in with your email",
        `${agent}${intro}<p>Connect your Print with Poppy account to this agent. We’ll email you a code—no password needed.</p>${errorLine(error)}<form method="post" action="${base}/email">${hidden(flow)}<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required><button>Send code</button></form><small>New here? Verifying your email creates your account.</small>`,
      ),
    );
  }
}

export function readCookie(req: Request, name: string) {
  return (req.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Load a browser flow bound to this browser's cookie, CSRF token and same-origin form post. */
export function loadFlow(
  req: Request,
  kind: "direct" | "device",
  cookieName: string,
): BrowserFlow {
  const f =
    typeof req.body?.flow === "string" &&
    get<BrowserFlow>("browser-signin", req.body.flow);
  const cookie = readCookie(req, cookieName);
  if (
    !f ||
    (f.kind || "direct") !== kind ||
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

/** Show a sign-in problem (bad sandbox email, rate limit, email outage) on the page, not as JSON. */
export async function pageErrors<T>(
  res: Response,
  show: (message: string) => void,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof HttpError) || ![400, 429, 503].includes(e.status)) throw e;
    res.status(e.status);
    if (e.status === 429) res.set("Retry-After", "3600");
    show(e.message);
    return undefined;
  }
}
