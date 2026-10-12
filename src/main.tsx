import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./style.css";
import { productOf, shippingSummary } from "./offer";
type Config = { mode: string; origin: string; support: string };
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
          src="/photos/poppy-abstract-close.webp"
          alt=""
        />
        <img
          className="brand-photo middle"
          src="/photos/poppy-abstract-portrait.webp"
          alt=""
        />
        <img
          className="brand-photo front"
          src="/photos/poppy-abstract-cluster.webp"
          alt=""
        />
      </span>
      <span>
        print with <strong>poppy</strong>
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
      <nav
        className="audience-toggle"
        data-agents={agents}
        aria-label="Choose a view"
      >
        <a
          href="/"
          onClick={(e) => navigate(e, "/")}
          aria-current={!agents ? "page" : undefined}
        >
          For humans
        </a>
        <a
          href="/for-agents"
          onClick={(e) => navigate(e, "/for-agents")}
          aria-current={agents ? "page" : undefined}
        >
          For Personal Agents
        </a>
      </nav>
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
              The <a href="/docs">API reference</a> shows your agent how
              to browse products, upload photos and prepare an order.
            </p>
            {!compact && (
              <div className="api-reference">
                <div className="reference-heading">
                  <a className="docs-reference-link" href="/docs">OpenAPI reference <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M7 17L17 7" /></svg><span className="docs-link-label">View full reference</span></a>
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
          <h2>A few more details</h2>
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
          <Faq title="When will my prints arrive?">
            <p>
              Allow an estimated 7–12 business days after payment for US home
              delivery. This is a planning estimate, not a guaranteed arrival
              date. We email confirmation and tracking when available. Photo
              prints and larger prints are ordered separately.
            </p>
          </Faq>
        </div>
      </section>
      <div className="footer-bottom">
        <Brand />
        <a href="https://x.com/spenciefy">a project by @spenciefy</a>
        <a href="/privacy">Photo privacy</a>
        <a href="https://github.com/spenciefy/print-with-poppy">Source code</a>
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
  const prompt = `Order my photos from ${config.origin} using Personal Agent Protocol. Read /agent.txt, /.well-known/poppy.json and the catalog. Use the documented guest API if you do not support native Poppy sessions. Help me choose 4×6 prints or one 12×16 matte print. Show me the photos, crops, full shipping address, email, delivery estimate and total including tax for approval. Only after I approve, and if the store is accepting live orders, pay with your authorized card.`;
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
            <img src="/photos/poppy-abstract-close.webp" alt="" />
            <img src="/photos/poppy-abstract-cluster.webp" alt="" />
          </div>
          <div className="product-copy">
            <div className="product-title">
              <h2>Photo prints</h2>
              <span>$12</span>
            </div>
            <p className="product-spec">4 × 6 inches · Lustre finish</p>
            <p>Five prints included. Each extra print is 50¢.</p>
          </div>
        </article>
        <article className="store-product">
          <div className="product-preview poster-preview">
            <img
              src="/photos/poppy-abstract-portrait.webp"
              alt="Example vertical 12 by 16 wall print of abstract orange poppies"
            />
          </div>
          <div className="product-copy">
            <div className="product-title">
              <h2>One for the wall</h2>
              <span>$35</span>
            </div>
            <p className="product-spec">12 × 16 inches · Portrait · Matte</p>
            <p>A portrait photo on heavyweight paper. Unframed.</p>
          </div>
        </article>
      </div>
      <p className="store-delivery">
        {shippingSummary} Tax shown before approval.
        <br />
        Estimated delivery: 7–12 business days after payment.
      </p>
      <p className="home-status" role="status">
        {config.mode === "live"
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
          <button className="instructions-copy" onClick={copy}>
            <CopyIcon copied={copied} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="instructions-text">{prompt}</p>
        <p className="instructions-feedback" aria-live="polite">
          {error ||
            (copied
              ? "Copied to clipboard."
              : "Paste into your agent, then attach your photos.")}
        </p>
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
  return (
    <main className="agent-document">
      <h1>Print with Poppy — agent instructions</h1>
      <p>
        Order photo prints for your user. US home delivery only. Prices are in
        USD.
      </p>
      <ul className="agent-references">
        <li>
          <a className="docs-reference-link" href="/docs">OpenAPI reference <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M7 17L17 7" /></svg><span className="docs-link-label">View full reference</span></a> — endpoints, request
          fields and responses
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
        4×6 lustre photos or <code>poster</code> for one 12×16 matte print. One
        product per order; read prices and quantity limits from the catalog.
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
      <p>
        <strong>HTTP compatibility:</strong> if native Poppy is unavailable,
        request a guest session. No registration is required. This path does not
        verify a native Poppy agent identity.
      </p>
      <pre>
        <code>{`POST /api/agent-sessions
Content-Type: application/json

{}`}</code>
      </pre>
      <p>Use the returned token on subsequent API calls:</p>
      <pre>
        <code>Authorization: Bearer &lt;access_token&gt;</code>
      </pre>
      <p>
        Keep it private. It expires after 24 hours. Do not put tokens in URLs or
        share them between users. Muse and Instinct have not yet been verified
        end to end.
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
        <code>contain</code> to preserve the image with white borders, or{" "}
        <code>cover</code> for a center crop.
      </p>
      <p>
        Show <code>operation.summary</code> verbatim, with the returned
        previews. The user must approve the exact photos, quantities, crops,
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
      <p>
        Use the authorized card at the returned Stripe-hosted checkout. Never
        send card numbers or CVC to this API. Ask the user for help if the bank
        requires authentication. Successful operation status means checkout was
        created; it does not mean payment or printing succeeded.
      </p>
      <h2>6. Verify and track</h2>
      <p>
        <code>GET /api/orders/&#123;order_id&#125;</code> to check payment,
        print submission and shipment. Save the private order-status link.
        Confirmation and shipment emails go to the approved email address;
        tracking is included when available.
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
        <a href="https://github.com/spenciefy/print-with-poppy">Source code</a>
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
      <h3>{q.items.reduce((n: number, i: any) => n + i.quantity, 0)} prints</h3>
      <p className="muted">
        {productOf(q).name} · {q.finish}
      </p>
      <dl className="price-list">
        <div>
          <dt>Photo prints</dt>
          <dd>{money(q.subtotal)}</dd>
        </div>
        <div>
          <dt>Home delivery</dt>
          <dd>{q.shipping === 0 ? "Included" : money(q.shipping)}</dd>
        </div>
        <div>
          <dt>Sales tax</dt>
          <dd>{money(q.tax)}</dd>
        </div>
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
  const [emailIndex, setEmailIndex] = useState<number | null>(null);
  const headers = { "X-Order-Token": token };
  const refresh = () =>
    api(`/api/order-view/${rid}`, { headers })
      .then(setOrder)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [rid]);
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
      <main className="document">
        <h1>
          {error ? "We couldn’t find that order." : "Finding your prints…"}
        </h1>
        <p role={error ? "alert" : undefined}>{error || "One moment."}</p>
        <a href="/">Back to Poppy</a>
      </main>
    );
  const stages = ["paid", "printing", "shipped"];
  const labels: Record<string, string> = {
    awaiting_payment: "One last little step.",
    expired: "This checkout has expired.",
    paid: "Your good ones are ordered.",
    submitted: "Off to the print lab.",
    printing: "Your memories are taking shape.",
    partially_shipped: "Your prints are on their way.",
    shipped: "Happy mail is on its way.",
    attention: "Your prints need a little attention.",
    cancelled: "An update on your order.",
  };
  const step =
    order.status === "shipped"
      ? 2
      : ["printing", "submitted", "partially_shipped"].includes(order.status)
        ? 1
        : order.paidAt
          ? 0
          : -1;
  return (
    <main className="order-shell">
      {order.demo && (
        <div className="demo-banner">
          <span>✳ DEMO ORDER</span> No charge. No prints shipped. Emails are
          previews only.
        </div>
      )}
      <div className="order-heading">
        <p className="eyebrow">
          {checkout
            ? "03 / THE CHECKOUT"
            : "A LITTLE SOMETHING TO LOOK FORWARD TO"}
        </p>
        <h1>
          {checkout
            ? "Ready when you are."
            : labels[order.status] || "Your print order."}
        </h1>
        <p>
          {checkout
            ? "In a live order, your agent uses its card on Stripe’s secure checkout page."
            : "We’ll email you as your photos make their way home."}
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
                  src="/photos/poppy-abstract-close.webp"
                  alt=""
                />
                <img
                  className="brand-photo middle"
                  src="/photos/poppy-abstract-close.webp"
                  alt=""
                />
                <img
                  className="brand-photo front"
                  src="/photos/poppy-abstract-close.webp"
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
              <ol className="order-progress">
                {stages.map((s, i) => (
                  <li className={i <= step ? "complete" : ""} key={s}>
                    <span>{i <= step ? "✓" : i + 1}</span>
                    {
                      [
                        "Payment received",
                        "At the print lab",
                        "Shipped to you",
                      ][i]
                    }
                  </li>
                ))}
              </ol>
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
              {order.shipments.map((s: any) => (
                <div className="shipment" key={s.id}>
                  <h3>
                    {s.status === "Shipped"
                      ? "A package of good memories."
                      : "Preparing your package."}
                  </h3>
                  <p>
                    {s.carrier?.name || "Carrier pending"} · {s.status}
                  </p>
                  <p>
                    {s.tracking?.number
                      ? `Tracking: ${s.tracking.number}`
                      : "Tracking isn’t available for this shipment yet."}
                  </p>
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
                {order.quote.previews.map((p: any) => (
                  <figure key={p.photoId}>
                    <img src={p.url} alt={p.name} />
                    <figcaption>
                      {p.quantity} × {p.name}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {order.demo && order.paidAt && (
                <section className="demo-tools">
                  <h3>Follow the whole journey.</h3>
                  <p>
                    Advance the demo shipment and inspect the emails this order
                    would send.
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
          <p className="order-id">Order {order.id}</p>
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
      <Header route={route} navigate={navigate} />
      {route === "/variants" ? (
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
      {route !== "/" &&
        route !== "/for-agents" &&
        !route.startsWith("/variants") && <Footer />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
