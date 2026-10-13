import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./style.css";
import Demo from "./Demo";
import { orderSubtitle, visibleShipment } from "./order-copy";
import { productOf, shippingSummary, orderProducts, orderLabel } from "./offer";
type Config = { environment?: string; mode: string; origin: string; support: string };
const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
async function api(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.message || "Could not complete this request.");
  return data;
}
const Arrow = () => <span aria-hidden="true">↗</span>;
function Brand() {
  return (
    <a className="brand" href="/" aria-label="Print with Poppy home">
      <span className="brand-stack" aria-hidden="true">
        <img
          className="brand-photo back"
          src="/photos/poppy-abstract-yellow.webp"
          alt=""
        />
        <img
          className="brand-photo middle"
          src="/photos/poppy-abstract-red.webp"
          alt=""
        />
        <img
          className="brand-photo front"
          src="/photos/poppy-abstract-cluster.webp"
          alt=""
        />
      </span>
      <span>
        Print with <strong>Poppy</strong>
      </span>
    </a>
  );
}
function Header({
  route,
  navigate,
}: {
  route: string;
  navigate: (event: React.MouseEvent<HTMLAnchorElement>, path: string) => void;
}) {
  const agents = route === "/for-agents";
  return (
    <header>
      <Brand />
      {!route.startsWith("/order/") && !route.startsWith("/checkout/") && <nav
        className="audience-toggle"
        data-agents={agents}
        aria-label="Choose a view"
      >
        <a
          href="/"
          onClick={(e) => navigate(e, "/")}
          aria-current={!agents ? "page" : undefined}
        >
          For Humans
        </a>
        <a
          href="/for-agents"
          onClick={(e) => navigate(e, "/for-agents")}
          aria-current={agents ? "page" : undefined}
        >
          For Personal Agents
        </a>
      </nav>}
    </header>
  );
}
function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {copied ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" />
        </>
      )}
    </svg>
  );
}
function Faq({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="faq-item">
      <h3>{title}</h3>
      <div className="faq-content">{children}</div>
    </div>
  );
}

function DiscoveryBox() {
  const [data, setData] = useState<object>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api("/.well-known/poppy.json", { signal: controller.signal })
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="discovery-box">
      <div className="reference-heading">
        <a href="/.well-known/poppy.json">poppy.json</a>
        <span>Discovery document</span>
      </div>
      <pre aria-label="Published Poppy discovery document">
        <code>
          {data
            ? JSON.stringify(data, null, 2)
            : failed
              ? "Unable to load discovery. Open poppy.json using the link above."
              : "Loading published discovery document…"}
        </code>
      </pre>
    </div>
  );
}
function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`protocol-footer${compact ? " protocol-concise" : ""}`}>
      <section aria-labelledby="protocol-title">
        <h2 id="protocol-title">How does Print with Poppy work?</h2>
        <p>
          Print with Poppy shows how personal agents can interact with real
          businesses. It implements Personal Agent Protocol so agents can
          discover the store, use its APIs and request your approval to place an
          order.
        </p>
        <div className="protocol-reference-grid">
          <div className="protocol-step">
            <h3>1. Your agent finds the front door.</h3>
            <p>
              <a href="/.well-known/poppy.json">poppy.json</a> points your agent
              to the store’s identity, authentication and APIs.
            </p>
            {!compact && <DiscoveryBox />}
          </div>
          <div className="protocol-step">
            <h3>2. The API tells it what to do next.</h3>
            <p>
              The <a href="/docs">API reference</a> shows your agent how to
              browse products, upload photos and prepare an order.
            </p>
            {!compact && (
              <div className="api-reference">
                <div className="reference-heading">
                  <a className="docs-reference-link" href="/docs">
                    OpenAPI reference{" "}
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M7 7h10v10M7 17L17 7" />
                    </svg>
                    <span className="docs-link-label">View full reference</span>
                  </a>
                  <span>Store API</span>
                </div>
                <dl>
                  {[
                    [
                      "GET",
                      "/api/catalog",
                      "Products, prices and availability",
                    ],
                    ["POST", "/api/photos", "Private photo uploads"],
                    [
                      "POST",
                      "/api/orders",
                      "An order proposal for your approval",
                    ],
                    [
                      "POST",
                      "/api/operations/{id}/confirm",
                      "Confirm the approved revision",
                    ],
                    [
                      "GET",
                      "/api/orders/{id}",
                      "Payment, printing and tracking",
                    ],
                  ].map(([method, path, description]) => (
                    <div key={path}>
                      <dt>
                        <span>{method}</span>
                        <code>{path}</code>
                      </dt>
                      <dd>{description}</dd>
                    </div>
                  ))}
                </dl>
                <a href="/agent.txt">Read the complete agent instructions</a>
              </div>
            )}
          </div>
        </div>
        <div className="protocol-approval protocol-step">
          <h3>3. You approve. Your agent takes it from there.</h3>
          <p>
            After you approve the photos, delivery address and final total, your
            agent pays and we email confirmation and tracking when available.
          </p>
        </div>
        <div className="store-faq">
          <h2>FAQ</h2>
          <Faq title="This seems expensive for just photo prints.">
            <p>
              For small orders, shipping costs more than printing the photos.
              That cost is spread across more prints when you order more, so
              the price per print comes down. I’m aiming to run small orders
              close to break-even, with around $1–$2 left after printing,
              shipping and fees. Larger orders contribute a little more.
            </p>
          </Faq>
          <Faq title="Does this work with Muse or Instinct?">
            <p>
              There are two integration paths: native Poppy sessions and a plain
              HTTP guest API for agents that can upload files and call APIs. The
              guest path uses the same order approval and payment flow, but does
              not verify the agent’s identity through Poppy. Muse and Instinct
              have not yet been tested end to end with this store; browser
              access alone does not guarantee compatibility.
            </p>
          </Faq>

          <Faq title="What do I approve, and how is payment handled?">
            <p>
              Your agent shows the photos, crop previews, quantities, full
              delivery address, email, estimated delivery and final total
              including tax. Approval applies to that exact order. After
              approval, the API returns a hosted Stripe Checkout link for your
              agent to pay with its authorized card. Payment information goes to
              Stripe, never our photo API. Your bank may ask you to
              authenticate.
            </p>
          </Faq>
          <Faq title="Can I buy directly on this website?">
            <p>
              Orders start with a personal agent. There’s no cart or checkout
              button here. Agents can use native Poppy or our HTTP guest API.
              Native Poppy identities need registration; guest API sessions do
              not. Your agent needs file upload, API and payment tools;{" "}
              <a href="/for-agents">see the integration guide</a>.
            </p>
          </Faq>
          <Faq title="Can my agent see previous orders?">
            <p>
              Yes. Ask your agent to sign in with your email. Verify a one-time
              code and approve access; orders you place while signed in will be
              saved to your account. You can disconnect through your agent at
              any time. Guest ordering still works without an account.
            </p>
          </Faq>
          <Faq title="When will my prints arrive?">
            <p>
              Allow an estimated 7–12 business days after payment for US home
              delivery. This is a planning estimate, not a guaranteed arrival
              date. We email confirmation and tracking when available. US shipping is included. Products can share one order but may arrive in separate packages.
            </p>
          </Faq>
        </div>
      </section>
      <div className="footer-bottom">
        <Brand />
        <a href="https://x.com/spenciefy">a project by @spenciefy</a>
        <a href="/privacy">Photo privacy</a>
        <a href="https://github.com/spenciefy/print-with-poppy">
          View on Github
        </a>
        <a href="https://personalagentprotocol.org/">Personal Agent Protocol</a>
      </div>
    </footer>
  );
}
const variants = [
  {
    id: "compact",
    name: "Compact",
    description: "Small product previews, concise rows, then the agent prompt.",
  },
  {
    id: "agent-first",
    name: "Agent first",
    description:
      "Start with the copyable prompt; products follow in a quiet list.",
  },
  {
    id: "gallery",
    name: "Gallery",
    description:
      "Larger product images, stacked vertically with generous space.",
  },
] as const;
type HomeVariant = (typeof variants)[number]["id"];
function VariantNav({ current }: { current?: HomeVariant }) {
  return (
    <nav className="variant-nav" aria-label="Homepage variants">
      <a href="/variants">All variants</a>
      {variants.map((v) => (
        <a
          key={v.id}
          href={`/variants/${v.id}`}
          aria-current={current === v.id ? "page" : undefined}
        >
          {v.name}
        </a>
      ))}
      <a href="/">Original</a>
    </nav>
  );
}
function VariantIndex() {
  return (
    <main className="variant-index">
      <h1>Single-column explorations</h1>
      <p>Three ways to keep the store simple.</p>
      {variants.map((v) => (
        <a className="variant-option" key={v.id} href={`/variants/${v.id}`}>
          <h2>
            {v.name} <Arrow />
          </h2>
          <p>{v.description}</p>
        </a>
      ))}
      <a href="/">View the original homepage</a>
    </main>
  );
}
function Home({ config, variant }: { config: Config; variant?: HomeVariant }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const sandbox = config.environment === "agent-sandbox";
  const prompt = sandbox ? `I want to test ordering photo prints using ${config.origin} via Personal Agent Protocol. Read /.well-known/poppy.json and verify /api/config says environment=agent-sandbox. Ask me for sample photos and use fictional shipping details and my email address for test emails. Show the proposal and ask for approval, then use simulatePayment and simulateShipment and show the captured confirmation and shipping emails. No real card or prints. Order emails may be sent to the order email address. Keep all requests and session tokens on this sandbox origin.` : `Please help me order photo prints from https://printwithpoppy.com. If you support Personal Agent Protocol and native Poppy sessions, read /.well-known/poppy.json and the catalog. If you do not support native Poppy sessions, use https://printwithpoppy.com/api/compat/instructions for HTTP compatibility access; no private signing key is needed.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setError("");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Select and copy the instructions below.");
    }
  }
  const productSection = (
    <section className="store-products" aria-labelledby="home-title">
      <div className="store-heading">
        <h1 id="home-title">Your photos, in print.</h1>
        <p>Ordered by your personal agent. Delivered to your door.</p>
      </div>
      <div className="product-list">
        <article className="store-product">
          <div
            className="product-preview prints-preview"
            role="img"
            aria-label="Example 4 by 6 photo prints with white borders"
          >
            <img src="/photos/poppy-abstract-cluster.webp" alt="" />
            <img src="/photos/poppy-abstract-yellow.webp" alt="" />
          </div>
          <div className="product-copy">
            <div className="product-title">
              <h2>Photo prints</h2>
              <span>$12</span>
            </div>
            <p className="product-spec">4 × 6 or 4 × 4 inches · Lustre finish</p>
            <p>Mix both sizes: five prints included. Each extra print is 50¢.</p>
          </div>
        </article>
        <article className="store-product">
          <div className="product-preview enlargement-preview"><img src="/photos/poppy-abstract-cluster.webp" alt="Example 8 by 10 lustre print of orange poppies" /></div>
          <div className="product-copy"><div className="product-title"><h2>Large photo print</h2><span>$12</span></div><p className="product-spec">8 × 10 inches · Lustre finish</p><p>One for $12, two for $17.50. Each additional print is $2.50. Unframed.</p></div>
        </article>
        <article className="store-product">
          <div className="product-preview poster-preview">
            <img
              src="/photos/poppy-abstract-red.webp"
              alt="Example vertical 12 by 16 wall print of abstract red poppies"
            />
          </div>
          <div className="product-copy">
            <div className="product-title">
              <h2>Poster print</h2>
              <span>$28</span>
            </div>
            <p className="product-spec">12 × 16 inches · Portrait · Matte</p>
            <p>A portrait photo on heavyweight paper. Unframed.</p>
          </div>
        </article>
      </div>
      <p className="store-delivery">
        Currently shipping within the United States only. {shippingSummary} Save $5 when combining small prints and 8×10s in one order. Tax shown before approval.
        <br />
        {sandbox ? "Illustrative prices and delivery estimates only. Nothing will be printed or shipped." : "Estimated delivery: 7–12 business days after payment."}
      </p>
      <p className="home-status" role="status">
        {sandbox ? "Ready for sample orders through personal agents." : config.mode === "live"
          ? "Accepting orders through personal agents."
          : config.mode === "loading"
            ? "Checking ordering availability…"
            : config.mode === "unavailable"
              ? "Ordering availability could not be checked. Please try again shortly."
              : "Ordering opens soon. Payments and physical fulfillment are not enabled yet."}
      </p>
    </section>
  );
  const promptSection = (
    <section className="store-order" aria-labelledby="instructions-label">
      <div className="agent-instructions">
        <div className="instructions-heading">
          <h2 id="instructions-label">Copy prompt for your personal agent</h2>
        </div>
        <p className="instructions-text">{prompt}</p>
        <div className="instructions-actions">
          <button
            className="instructions-copy"
            onClick={copy}
            aria-live="polite"
          >
            <CopyIcon copied={copied} />
            {copied ? "Copied" : "Copy"}
          </button>
          <a className="instructions-copy" href="/demo">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4 2.5v11L13 8z" />
            </svg>
            Play demo
          </a>
        </div>
        {error && (
          <p className="instructions-feedback" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
  return (
    <div className={variant ? `home-variant variant-${variant}` : undefined}>
      {variant && <VariantNav current={variant} />}
      <main className="home-minimal store-home">
        {variant === "agent-first" ? (
          <>
            {promptSection}
            {productSection}
          </>
        ) : (
          <>
            {productSection}
            {promptSection}
          </>
        )}
      </main>
      <Footer compact={Boolean(variant)} />
    </div>
  );
}

function Guide({ config }: { config: Config }) {
  const sandbox = config.environment === "agent-sandbox";
  return (
    <main className="agent-document">
      <h1>Print with Poppy — agent instructions</h1>
      <p>
        {sandbox ? <>Test the full ordering flow with sample photos and fictional US addresses. No card or physical prints. Order emails may be sent to the order email address. <a href="/sandbox">Sandbox testing guide</a>.</> : <>Order photo prints for your user. US home delivery only. Prices are in USD.</>}
      </p>
      <ul className="agent-references">
        <li>
          <a className="docs-reference-link" href="/docs">
            OpenAPI reference{" "}
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 7h10v10M7 17L17 7" />
            </svg>
            <span className="docs-link-label">View full reference</span>
          </a>{" "}
          — endpoints, request fields and responses
        </li>
        <li>
          <a href="/.well-known/poppy.json">poppy.json</a> — Poppy discovery and
          authentication issuer
        </li>
        <li>
          <a href="/agent.txt">Plain-text instructions</a> — machine-readable
          ordering guide
        </li>
        <li>
          <a href="/api/catalog">Product catalog</a> — current prices and
          payment mode
        </li>
      </ul>
      <h2>1. Check availability and choose a product</h2>
      <p>
        Read <code>GET /api/catalog</code>. Only attempt a real payment when{" "}
        <code>mode</code> is <code>live</code>. Choose <code>prints</code> for
        4×6 lustre photos, <code>square</code> for 4×4, <code>enlargement</code> for 8×10 lustre, or <code>poster</code> for one 12×16 matte print. All products can share one order: set product on each item. US shipping is included; combining small prints and 8×10s saves $5 once per order. Items may arrive separately. Read prices and quantity limits from the catalog.
      </p>
      <h2>2. Start a session</h2>
      <p>
        <strong>Native Poppy:</strong> read{" "}
        <a href="/.well-known/poppy.json">discovery</a> and{" "}
        <a href="/.well-known/oauth-authorization-server">OAuth metadata</a>.
        Use signed client and session assertions at <code>/oauth/token</code>,
        then a session token and DPoP proof on each request. Native client
        metadata URLs require registration with{" "}
        <a href={`mailto:${config.support}`}>{config.support}</a>.
      </p>
      {!sandbox && <p>
        <strong>Without native Poppy support:</strong> read the separate{" "}
        <a href="/api/compat/instructions">HTTP compatibility instructions</a>{" "}
        and <a href="/api/compat/openapi.json">compatibility API reference</a>.
        This path does not verify agent identity and is not protected by the
        native client allowlist. Native Poppy agents should use the session
        above. Muse and Instinct have not yet been verified end to end.
      </p>}
      <h3>Optional: sign in to save and view orders</h3>
      {sandbox ? <p>Use <code>auth.mediated</code> with a unique @example.com, @example.org or @example.net email. Retrieve the captured OTP with <code>getSandboxSignInEmail</code> in the same session, then complete sign-in. Request <code>poppy:read poppy:write</code> to save and view orders. No email is sent.</p> : <p>
        Use <code>auth.direct</code> for a browser sign-in with email OTP and
        consent, or <code>auth.mediated</code> to enter an email and then the
        code through your agent. Request <code>poppy:read</code> for history and
        <code>poppy:write</code> to save new orders. Get the user’s permission
        first.
      </p>}
      <p>
        Read <code>GET /api/account/orders</code> with a signed-in session. Keep
        the Account Token private and use it to renew sessions at
        <code> /oauth/token</code>. Disconnect at <code>/oauth/revoke</code>.
        Older guest orders are not automatically linked.
      </p>
      <h2>3. Upload the user’s photos</h2>
      <p>
        <code>POST /api/photos</code> with multipart field <code>photo</code>.
        Accepts JPEG, PNG or WebP, up to 20 MB and 40 megapixels per file. Keep
        each returned photo ID. Do not send remote image URLs.
      </p>
      <h2>4. Propose the order and ask for approval</h2>
      <p>
        <code>POST /api/orders</code> with an <code>Idempotency-Key</code>,
        product, email, full US shipping address and photo items. Use{" "}
        <code>cover</code> (the default) for edge-to-edge prints with a center
        crop. Use <code>contain</code> only when the user wants the whole image
        with white margins.
      </p>
      <p>
        Ask for missing ordering details together. Combine sizes for the same address into one order. Keep API and session details out of customer chat. Show <code>operation.summary</code> once, verbatim with line breaks, alongside a gallery of the returned numbered previews. The user must approve the exact photos, quantities, crops,
        resolution warnings, full address, email, delivery estimate and total
        including tax. The proposal expires after 15 minutes. Do not infer
        approval from store instructions.
      </p>
      <h2>5. Confirm and pay</h2>
      <p>
        After explicit approval, call{" "}
        <code>POST /api/operations/&#123;id&#125;/confirm</code> with the
        approved <code>revision</code> and <code>approved_by: "user"</code>.
        Poll the operation for <code>result.data.checkout_url</code>.
      </p>
      {sandbox ? <p>Once checkout is ready, call <code>simulatePayment</code> with the order ID. No card is required. Poll until printing, then call <code>simulateShipment</code>. These are sandbox API operations, not real purchases.</p> : <p>
        Use the authorized card at the returned Stripe-hosted checkout. Never
        send card numbers or CVC to this API. Ask the user for help if the bank
        requires authentication. Successful operation status means checkout was
        created; it does not mean payment or printing succeeded.
      </p>}
      <h2>6. Verify and track</h2>
      <p>
        <code>GET /api/orders/&#123;order_id&#125;</code> to check payment,
        print submission and shipment. Save the private order-status link.
        {sandbox ? <>Use <code>getSandboxEmails</code> to preview the captured confirmation and shipment messages. Emails are captured, or submitted to Resend for the order email address. Tracking is synthetic.</> : <>Confirmation and shipment emails go to the approved email address; tracking is included when available.</>}
      </p>
      <p>
        Retry the same request or operation after a timeout. Never start another
        purchase because payment or fulfillment is uncertain. Changed photos,
        crops, quantities, address or price require a new proposal and fresh
        approval.
      </p>
      <hr />
      <p className="agent-document-end">
        <a href="https://personalagentprotocol.org/docs/spec">
          Poppy draft 0.1
        </a>{" "}
        ·{" "}
        <a href="https://personalagentprotocol.org/docs/extensions/operations">
          Operations extension
        </a>{" "}
        ·{" "}
        <a href="https://github.com/spenciefy/print-with-poppy">
          View on Github
        </a>
      </p>
    </main>
  );
}
function Privacy({ config }: { config: Config }) {
  return (
    <main className="document">
      <p className="eyebrow">YOUR PHOTOS ARE PERSONAL.</p>
      <h1>Just for printing.</h1>
      <p className="intro">
        We use your photos to prepare previews and fulfill your print order.
      </p>
      <h3>Where your photos go</h3>
      <p>
        Photos are stored privately and shared with our print partner through
        temporary links for printing. We remove image metadata when preparing
        print files. We don't publish your uploaded photos.
      </p>
      <h3>When we delete them</h3>
      <p>
        Unused photos are removed after 24 hours. Photos for shipped orders are
        removed 30 days after shipment. Photos in unresolved paid orders are
        retained while we resolve fulfillment.
      </p>
      <h3>Payments and emails</h3>
      <p>
        Stripe handles card details. Our print partner receives the delivery
        information it needs to fulfill your order. Resend delivers order and
        shipment emails. We retain order and transaction records to support your
        purchase.
      </p>
      <h3>Optional accounts</h3>
      <p>
        We verify your email with a one-time code sent by Resend. With your
        permission, a connected personal agent can view your account’s order
        history. New orders placed while signed in are linked to your account;
        existing guest orders are not automatically linked. Disconnect through
        your agent to revoke access. Sign-in requests expire in minutes, and
        account access expires after 30 days unless you sign in again.
      </p>
      <h3>Questions or deletion requests</h3>
      <p>
        <a href={`mailto:${config.support}`}>{config.support}</a>
      </p>
    </main>
  );
}
function OrderSummary({ quote: q }: { quote: any }) {
  return (
    <>
      <p className="eyebrow">ORDER SUMMARY</p>
      <h3>{q.items.reduce((n: number, i: any) => n + i.quantity, 0)} {orderProducts(q).length > 1 ? "items" : "prints"}</h3>
      <p className="muted">
        {orderLabel(q)} · {q.finish}
      </p>
      <dl className="price-list">
        <div><dt>Prints</dt><dd>{money(q.subtotal)}</dd></div>
        <div>
          <dt>Home delivery</dt>
          <dd>{q.shipping === 0 ? "Included" : money(q.shipping)}</dd>
        </div>
        <div>
          <dt>Sales tax</dt>
          <dd>{money(q.tax)}</dd>
        </div>
        {!!q.discount && <div><dt>Discount</dt><dd>−{money(q.discount)}</dd></div>}
        <div className="total">
          <dt>Total · USD</dt>
          <dd>{money(q.total)}</dd>
        </div>
      </dl>
      <div className="address-block">
        <p className="eyebrow">DELIVERING TO</p>
        <address>
          {q.address.name}
          <br />
          {q.address.line1}
          <br />
          {q.address.line2 && (
            <>
              {q.address.line2}
              <br />
            </>
          )}
          {q.address.city}, {q.address.state} {q.address.postalCode}
          <br />
          United States
        </address>
        <p className="email-address">{q.email}</p>
      </div>
      <p className="estimate">{q.estimate}</p>
    </>
  );
}
function OrderPage({ checkout = false }: { checkout?: boolean }) {
  const rid = window.location.pathname.split("/").pop()!;
  const token =
    window.location.hash.slice(1) ||
    sessionStorage.getItem(`order:${rid}`) ||
    "";
  if (token) sessionStorage.setItem(`order:${rid}`, token);
  const [order, setOrder] = useState<any>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [emailIndex, setEmailIndex] = useState<number | null>(null);
  const headers = { "X-Order-Token": token };
  const refresh = () =>
    api(`/api/order-view/${rid}`, { headers })
      .then((freshOrder) => { setOrder(freshOrder); setError(""); })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!token) return;
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [rid, token]);
  async function openReceipt() {
    setReceiptBusy(true);
    setReceiptError("");
    try {
      const result = await api(`/api/order-view/${rid}/receipt`, { headers });
      window.location.assign(result.url);
    } catch (e) { setReceiptError((e as Error).message); }
    finally { setReceiptBusy(false); }
  }
  async function action(action: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/demo/${action}/${rid}`, { method: "POST", headers });
      if (action === "pay") window.location.assign(`/order/${rid}#${token}`);
      else await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!order)
    return (
      <main className="order-shell order-message">
        {token && !error && <div className="order-loading-photos" aria-hidden="true">
          <img src="/photos/poppy-abstract-cluster.webp" alt="" width="64" height="64" />
          <img src="/photos/poppy-abstract-yellow.webp" alt="" width="64" height="64" />
          <img src="/photos/poppy-abstract-red.webp" alt="" width="64" height="64" />
        </div>}
        <h1 role={token && !error ? "status" : undefined}>{!token ? "This link is incomplete." : error ? "We couldn’t load your order." : "Loading your order…"}</h1>
        {(!token || error) && <p role={error ? "alert" : undefined}>{!token
          ? "Open the full private link from your confirmation email, or ask your agent to resend it with the part after # included."
          : "The link may be invalid, or the service may be temporarily unavailable. Try again or use the link in your confirmation email."}</p>}
        {token && error && <button className="outline" onClick={() => void refresh()}>Try again</button>}
      </main>
    );
  const labels: Record<string, string> = {
    awaiting_payment: "Payment pending.",
    expired: "This checkout has expired.",
    paid: "Your order is confirmed.",
    submitted: "Your order is confirmed.",
    printing: "Your order is confirmed.",
    partially_shipped: "Your prints are on their way.",
    shipped: "Your prints have shipped.",
    attention: "Your order needs attention.",
    cancelled: "An update on your order.",
  };
  return (
    <main className="order-shell">
      {order.demo && (
        <div className="demo-banner">
          <span>✳ DEMO ORDER</span> No charge. No prints shipped. Emails are
          previews only.
        </div>
      )}
      <div className="order-heading">
        <h1>
          {checkout
            ? "Ready when you are."
            : labels[order.status] || "Your print order."}
        </h1>
        <div className="order-reference-row">
          <p className="order-reference">Order {order.id}</p>
          {!order.demo && !!order.paidAt && order.quote.total > 0 && <button className="text-button receipt-link" disabled={receiptBusy} onClick={() => void openReceipt()}>{receiptBusy ? "Loading payment…" : "View Stripe payment"}</button>}
          {!order.demo && !order.paidAt && order.status === "awaiting_payment" && order.checkoutUrl && !order.checkoutExpired && <a className="text-link receipt-link" href={order.checkoutUrl}>View Stripe payment</a>}
        </div>
        {receiptError && <p className="error" role="alert">{receiptError}</p>}
        <p>
          {checkout
            ? "In a live order, your agent uses its card on Stripe’s secure checkout page."
            : orderSubtitle(order.status)}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="review-layout">
        <div>
          {checkout ? (
            <section className="checkout-demo">
              <span className="brand-stack" aria-hidden="true">
                <img
                  className="brand-photo back"
                  src="/photos/poppy-abstract-yellow.webp"
                  alt=""
                />
                <img
                  className="brand-photo middle"
                  src="/photos/poppy-abstract-red.webp"
                  alt=""
                />
                <img
                  className="brand-photo front"
                  src="/photos/poppy-abstract-cluster.webp"
                  alt=""
                />
              </span>
              <h2>
                Make-believe payment.
                <br />
                Real order flow.
              </h2>
              <p>
                This simulates a successful card payment. It runs the order
                through our demo fulfillment and email queue.
              </p>
              <button
                className="primary"
                disabled={busy || !!order.paidAt || order.checkoutExpired}
                onClick={() => void action("pay")}
              >
                {order.checkoutExpired
                  ? "Checkout expired"
                  : busy
                    ? "Processing…"
                    : `Simulate payment of ${money(order.quote.total)}`}{" "}
                <Arrow />
              </button>
            </section>
          ) : (
            <>
              {order.issue && <p className="error">{order.issue}</p>}
              {order.status === "expired" && (
                <p>
                  This checkout expired without payment. Ask your agent to
                  prepare a new order.
                </p>
              )}
              {order.status === "awaiting_payment" &&
                (order.checkoutExpired ? (
                  <p>Your checkout expired. Ask your agent for a new quote.</p>
                ) : order.checkoutUrl ? (
                  <p>Your agent can complete payment after your approval.</p>
                ) : (
                  <p>Preparing your checkout…</p>
                ))}
              {order.shipments.filter(visibleShipment).map((s: any) => (
                <div className="shipment" key={s.id}>
                  <h3>
                    {s.status === "Shipped"
                      ? "Your package has shipped."
                      : s.status === "Cancelled"
                        ? "Shipment cancelled."
                        : "Tracking available."}
                  </h3>
                  {s.status === "Shipped" && s.carrier?.name && <p>Carrier: {s.carrier.name}</p>}
                  {s.tracking?.number && <p>Tracking: {s.tracking.number}</p>}
                  {s.tracking?.url && (
                    <a
                      className="text-link"
                      href={s.tracking.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Track package <Arrow />
                    </a>
                  )}
                </div>
              ))}
              <div className="photo-grid">
                {order.quote.previews.map((p: any, index: number) => (
                  <figure key={`${p.photoId}:${index}`}>
                    <img src={p.url} alt={p.name} />
                    <figcaption>
                      {p.quantity} × {p.name} · {productOf({ product: p.product ?? order.quote.product }).label}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {order.demo && order.paidAt && (
                <section className="demo-tools">
                  <h3>Follow the whole journey.</h3>
                  <p>
                    Advance the demo shipment and inspect the emails this order
                    generated.
                  </p>
                  <button
                    className="outline"
                    disabled={busy || order.status === "shipped"}
                    onClick={() => void action("ship")}
                  >
                    {order.status === "shipped"
                      ? "Demo shipment created"
                      : "Simulate shipment →"}
                  </button>
                  <div className="email-buttons">
                    {order.emails?.map((e: any, i: number) => (
                      <button
                        className="text-button"
                        key={i}
                        onClick={() =>
                          setEmailIndex(emailIndex === i ? null : i)
                        }
                      >
                        ✉ {e.subject}
                      </button>
                    ))}
                  </div>
                  {emailIndex !== null && order.emails?.[emailIndex] && (
                    <iframe
                      title="Order email preview"
                      sandbox=""
                      srcDoc={order.emails[emailIndex].html}
                    />
                  )}
                </section>
              )}
            </>
          )}
        </div>
        <aside className="order-paper">
          <OrderSummary quote={order.quote} />
          <p className="small muted">
            After payment, printing starts automatically. Contact support
            promptly for changes; cancellation isn’t guaranteed.
          </p>
        </aside>
      </div>
    </main>
  );
}
function App() {
  const [config, setConfig] = useState<Config>({
    mode: "loading",
    origin: window.location.origin,
    support: "hello@printwithpoppy.com",
  });
  useEffect(() => {
    api("/api/config")
      .then(setConfig)
      .catch(() =>
        setConfig((current) => ({ ...current, mode: "unavailable" })),
      );
  }, []);
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, path: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (route === path) return;
    const update = () => {
      window.history.pushState({}, "", path);
      flushSync(() => setRoute(path));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    if (
      document.startViewTransition &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      document.startViewTransition(update);
    else update();
  }
  const variant = variants.find((v) => route === `/variants/${v.id}`)?.id;
  return (
    <>
      {config.environment === "agent-sandbox" && <aside className="sandbox-banner" aria-label="Sandbox environment"><strong>Sandbox environment</strong><span>Sample orders only. No real payments or prints. Test emails are sent to your order email address when enabled.</span><a href="/sandbox">Testing guide ↗</a></aside>}
      <Header route={route} navigate={navigate} />
      {route === "/demo" ? (
        <Demo />
      ) : route === "/variants" ? (
        <VariantIndex />
      ) : variant ? (
        <Home config={config} variant={variant} />
      ) : route === "/for-agents" ? (
        <Guide config={config} />
      ) : route === "/privacy" ? (
        <Privacy config={config} />
      ) : route.startsWith("/order/") ? (
        <OrderPage />
      ) : route.startsWith("/checkout/") ? (
        <OrderPage checkout={config.mode === "demo"} />
      ) : route === "/" ? (
        <Home config={config} />
      ) : (
        <main className="document">
          <h1>A little lost?</h1>
          <a href="/">Back to Poppy →</a>
        </main>
      )}
      {route !== "/demo" &&
        route !== "/" &&
        route !== "/for-agents" &&
        !route.startsWith("/variants") &&
        !route.startsWith("/order/") &&
        !route.startsWith("/checkout/") && <Footer />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
