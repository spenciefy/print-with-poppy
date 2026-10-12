import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
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
      <img src="/poppy.png" alt="" />
      <span>
        print with <strong>poppy</strong>
      </span>
    </a>
  );
}
function Header({ config }: { config: Config }) {
  return (
    <header>
      <Brand />
      <nav aria-label="Main navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/for-agents">
          For agents <Arrow />
        </a>
        {config.mode === "demo" && (
          <a className="nav-demo" href="/demo">
            Try the demo
          </a>
        )}
      </nav>
    </header>
  );
}
function Footer() {
  return (
    <footer>
      <Brand />
      <p>A little less scrolling. A little more holding.</p>
      <div>
        <a href="/privacy">Photo privacy</a>
        <a
          href="https://personalagentprotocol.org/"
          target="_blank"
          rel="noreferrer"
        >
          Made for Poppy ↗
        </a>
      </div>
    </footer>
  );
}
function Home({ config }: { config: Config }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const prompt = `Use ${config.origin} to order my photos as 4×6 prints delivered to my home. Follow its Personal Agent Protocol instructions. Show me the photos, crop choices, full shipping address, email, delivery estimate and total including shipping and tax for approval. After I approve, use your authorized card at checkout.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Select and copy the instructions below.");
    }
  }
  return (
    <>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="tiny-flower">✳</span> FROM YOUR CAMERA ROLL, WITH
              LOVE
            </div>
            <h1>
              Print out
              <br />
              your <em>memories.</em>
            </h1>
            <p className="intro">
              The good ones deserve more than a screen.
              <br className="desktop" /> Ask your personal agent to turn your
              favorite photos into real prints, delivered to your door.
            </p>
            <button className="primary copy-button" onClick={copy}>
              <span>
                {copied
                  ? "Copied. Over to your agent!"
                  : "Copy instructions for my agent"}
              </span>
              <span aria-hidden="true">{copied ? "✓" : "↗"}</span>
            </button>
            <p className="under-button" aria-live="polite">
              {copied
                ? "Paste them into your agent, then share your photos."
                : "Your photos. Your agent. A little Poppy magic."}
            </p>
            <details className="prompt-details" open={!!error}>
              <summary>What am I copying?</summary>
              <p>{prompt}</p>
              {error && <p role="alert">{error}</p>}
            </details>
          </div>
          <div
            className="photo-scene"
            aria-label="A collection of printed landscape memories"
          >
            <figure className="print print-back">
              <img src="/photos/mountain.jpg" alt="Sunlit mountain peaks" />
              <figcaption>somewhere up there</figcaption>
            </figure>
            <figure className="print print-front">
              <img
                src="/photos/lake.jpg"
                alt="A quiet lake reflecting mountains at sunset"
              />
              <figcaption>one of those days.</figcaption>
            </figure>
            <figure className="print print-small">
              <img src="/photos/summer.jpg" alt="A golden summer landscape" />
              <figcaption>more of this, please.</figcaption>
            </figure>
            <div className="print-stamp">
              <span>REAL PHOTOS</span>
              <strong>4 × 6</strong>
              <span>HAPPY MAIL</span>
            </div>
            <img className="scene-poppy" src="/poppy.png" alt="" />
          </div>
        </section>
        <section className="ticker" aria-label="Print details">
          <span>4 × 6 photo prints</span>
          <span aria-hidden="true">✳</span>
          <span>Printed with care</span>
          <span aria-hidden="true">✳</span>
          <span>Delivered to your door</span>
          <span aria-hidden="true">✳</span>
          <span>Ordered by your agent</span>
        </section>
        <section className="how" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">LESS ADMIN. MORE ALBUM.</p>
            <h2>
              You make the memories.
              <br />
              Your agent does the rest.
            </h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-number">01</span>
              <h3>Pick your good ones.</h3>
              <p>
                Send your favorite photos to your personal agent. Holidays,
                everyday things, that very good dog.
              </p>
            </li>
            <li>
              <span className="step-number">02</span>
              <h3>Give it the go-ahead.</h3>
              <p>
                Your agent shows you the prints, delivery address, and full
                price. Nothing gets ordered without your approval.
              </p>
            </li>
            <li>
              <span className="step-number">03</span>
              <h3>Make room on the fridge.</h3>
              <p>
                Your agent checks out. We print, pack, and send a little
                happiness your way—with updates in your inbox.
              </p>
            </li>
          </ol>
        </section>
        <section className="note-section">
          <div className="little-note">
            <img src="/poppy.png" alt="" />
            <p>
              Not another thousand photos
              <br />
              you’ll forget to look at.
            </p>
            <span>A few you’ll love to live with.</span>
          </div>
          <div className="note-copy">
            <p className="eyebrow">A SMALL STORE. AN OPEN IDEA.</p>
            <h2>
              A friend to
              <br />
              your personal agent.
            </h2>
            <p>
              Poppy is an open protocol that helps personal agents work with
              real businesses. This is our little corner of it: turning pixels
              into something you can hold.
            </p>
            <a className="text-link" href="/for-agents">
              See how it works for agents <Arrow />
            </a>
            {config.mode === "demo" && (
              <a className="text-link secondary-link" href="/demo">
                Walk through a demo order <Arrow />
              </a>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
function Guide({ config }: { config: Config }) {
  return (
    <main className="document">
      <p className="eyebrow">HELLO, PERSONAL AGENTS.</p>
      <h1>
        A tiny store.
        <br />A complete API.
      </h1>
      <p className="intro">
        Discover, upload, approve, pay, track. Built on Personal Agent Protocol
        draft 0.1 with the operations extension.
      </p>
      <div className="doc-links">
        <a className="primary" href="/openapi.json">
          OpenAPI reference ↗
        </a>
        <a className="text-link" href="/agent.txt">
          Plain-text instructions ↗
        </a>
        <a className="text-link" href="/.well-known/poppy.json">
          poppy.json ↗
        </a>
      </div>
      <ol className="guide-steps">
        <li>
          <h3>Introduce yourself</h3>
          <p>
            Read the discovery document and OAuth metadata. Start a guest
            session using your signed client assertion, session assertion, and
            DPoP proof. No customer account needed.
          </p>
          <code>GET /.well-known/poppy.json</code>
        </li>
        <li>
          <h3>Share the photos</h3>
          <p>
            Upload JPEG, PNG, or WebP images (up to 20 MB each). Choose
            whole-image prints with white borders or a center crop. Review
            low-resolution warnings.
          </p>
          <code>POST /api/photos</code>
        </li>
        <li>
          <h3>Get the user's approval</h3>
          <p>
            Propose up to 100 prints with an email and full US shipping address.
            Present the complete summary and print previews. Explicit approval
            covers that exact revision—including shipping, tax, crop, and
            address.
          </p>
          <code>POST /api/orders → POST /api/operations/:id/confirm</code>
        </li>
        <li>
          <h3>Pay with your card</h3>
          <p>
            Read the operation until checkout is ready. Use your authorized card
            at the Stripe-hosted checkout URL. Never send card details to this
            API. Your user may need to help with issuer authentication.
          </p>
        </li>
        <li>
          <h3>Follow the happy mail</h3>
          <p>
            Read the order to verify payment, printing, and shipping separately.
            Confirmation and shipment updates go to the approved email address.
            Tracking appears when the printer provides it.
          </p>
          <code>GET /api/orders/:id</code>
        </li>
      </ol>
      <p className="callout">
        Agents register their HTTPS client metadata URL with{" "}
        <a href={`mailto:${config.support}`}>{config.support}</a>. Retry the
        same operation after timeouts; don't create a second purchase. For now:
        US delivery, USD, 4×6 prints.
      </p>
      <a
        className="text-link"
        href="https://personalagentprotocol.org/docs/spec"
      >
        Read the protocol specification ↗
      </a>
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
        Photos are stored privately and shared with Prodigi through temporary
        links for printing. We remove image metadata when preparing print files.
        We don't publish your uploaded photos.
      </p>
      <h3>When we delete them</h3>
      <p>
        Unused photos are removed after 24 hours. Photos for shipped orders are
        removed 30 days after shipment. Photos in unresolved paid orders are
        retained while we resolve fulfillment.
      </p>
      <h3>Payments and emails</h3>
      <p>
        Stripe handles card details. Prodigi receives the delivery information
        it needs to fulfill your order. Resend delivers order and shipment
        emails. We retain order and transaction records to support your
        purchase.
      </p>
      <h3>Questions or deletion requests</h3>
      <p>
        <a href={`mailto:${config.support}`}>{config.support}</a>
      </p>
    </main>
  );
}
const defaultAddress = {
  name: "Jamie Taylor",
  line1: "123 Market Street",
  line2: "Apt 4",
  city: "San Francisco",
  state: "CA",
  postalCode: "94103",
  country: "US",
};
function Demo() {
  const [token, setToken] = useState(
    sessionStorage.getItem("poppy-demo") || "",
  );
  const [photos, setPhotos] = useState<any[]>([]);
  const [address, setAddress] = useState(defaultAddress);
  const [email, setEmail] = useState("jamie@example.com");
  const [operation, setOperation] = useState<any>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  async function session() {
    if (token) return token;
    const r = await api("/api/demo/session", { method: "POST" });
    sessionStorage.setItem("poppy-demo", r.token);
    setToken(r.token);
    return r.token;
  }
  async function authFetch(url: string, init: RequestInit = {}) {
    const t = await session();
    return api(url, {
      ...init,
      headers: { Authorization: `Demo ${t}`, ...init.headers },
    });
  }
  async function add(files: File[]) {
    setBusy("Preparing your previews…");
    setError("");
    try {
      for (const f of files) {
        const body = new FormData();
        body.append("photo", f);
        const p = await authFetch("/api/photos", { method: "POST", body });
        setPhotos((prev) => [...prev, { ...p, quantity: 1, fit: "contain" }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function samples() {
    setBusy("Finding a few good ones…");
    try {
      const files = await Promise.all(
        ["lake", "summer", "mountain"].map(
          async (n) =>
            new File(
              [await (await fetch(`/photos/${n}.jpg`)).blob()],
              `${n}.jpg`,
              { type: "image/jpeg" },
            ),
        ),
      );
      await add(files);
    } catch {
      setError("Could not load sample photos.");
      setBusy("");
    }
  }
  async function quote(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy("Getting your quote…");
    try {
      const r = await authFetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          email,
          address,
          items: photos.map((p) => ({
            photoId: p.id,
            quantity: p.quantity,
            fit: p.fit,
          })),
        }),
      });
      setOperation(r.operation);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function approve() {
    setBusy("Preparing checkout…");
    setError("");
    try {
      let op = await authFetch(
        `/api/operations/${operation.operation_id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: operation.revision,
            approved_by: "user",
          }),
        },
      );
      for (let i = 0; i < 30 && op.state === "in_progress"; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        op = await authFetch(`/api/operations/${operation.operation_id}`);
      }
      if (op.state !== "succeeded")
        throw new Error(
          "Checkout is still being prepared. Retry this approval to check the same order.",
        );
      window.location.assign(op.result.data.checkout_url);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  return (
    <main className="order-shell">
      <div className="demo-banner">
        <span>✳ DEMO STUDIO</span> No charge. No prints shipped. No emails sent.
      </div>
      <div className="order-heading">
        <p className="eyebrow">
          {operation ? "02 / THE GO-AHEAD" : "01 / A FEW FAVORITES"}
        </p>
        <h1>
          {operation ? "Does everything look right?" : "A little practice run."}
        </h1>
        <p>
          {operation
            ? "This is what your agent asks you to approve before using its card."
            : "Try the same upload and approval flow your agent uses. Sample photos and prices are for demonstration."}
        </p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {operation ? (
        <div className="review-layout">
          <div>
            <PhotoGrid
              photos={operation.terms.previews.map((p: any) => ({
                ...p,
                id: p.photoId,
                previews: { [p.fit]: p.url },
              }))}
            />
            <div className="approval-summary">
              <h3>The exact approval summary</h3>
              <p>{operation.summary}</p>
            </div>
          </div>
          <aside className="order-paper">
            <OrderSummary quote={operation.terms} />
            <label className="approval-check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              <span>
                I approve these photos, crops, full shipping address, email, and
                total.
              </span>
            </label>
            <button
              className="primary full"
              disabled={!approved || !!busy}
              onClick={approve}
            >
              {busy || "Approve & continue to demo checkout"} <Arrow />
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                setOperation(undefined);
                setApproved(false);
              }}
            >
              ← Edit before approval
            </button>
          </aside>
        </div>
      ) : (
        <form onSubmit={quote}>
          <div className="studio-layout">
            <div>
              <div className="upload-zone">
                <span className="upload-glyph" aria-hidden="true">
                  ＋
                </span>
                <h3>Start with a memory.</h3>
                <p>JPEG, PNG or WebP · up to 20 MB each</p>
                <label className="primary">
                  Choose photos
                  <input
                    disabled={!!busy}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(e) => {
                      void add(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={samples}
                  disabled={!!busy}
                >
                  Or use three sample photos ↗
                </button>
              </div>
              <PhotoGrid
                photos={photos}
                edit={(rid, key, value) =>
                  setPhotos((prev) =>
                    prev.map((p) =>
                      p.id === rid ? { ...p, [key]: value } : p,
                    ),
                  )
                }
                remove={(rid) =>
                  setPhotos((prev) => prev.filter((p) => p.id !== rid))
                }
              />
            </div>
            <aside className="order-paper">
              <h3>Where’s the happy mail going?</h3>
              <p className="muted small">
                Use the example details for this demo.
              </p>
              <label>
                Confirmation email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {(
                [
                  ["name", "Full name"],
                  ["line1", "Street address"],
                  ["line2", "Apartment, suite, etc. (optional)"],
                  ["city", "City"],
                  ["state", "State (two letters)"],
                  ["postalCode", "ZIP code"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    required={key !== "line2"}
                    value={address[key]}
                    maxLength={key === "state" ? 2 : 150}
                    onChange={(e) =>
                      setAddress({
                        ...address,
                        [key]:
                          key === "state"
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <div className="country">
                United States <span>US delivery for now</span>
              </div>
              <button
                className="primary full"
                disabled={!photos.length || !!busy}
                type="submit"
              >
                {busy || "Preview my order"} <Arrow />
              </button>
              <p className="small muted">
                You’ll see the full price before approval.
              </p>
            </aside>
          </div>
        </form>
      )}
    </main>
  );
}
function PhotoGrid({
  photos,
  edit,
  remove,
}: {
  photos: any[];
  edit?: (id: string, key: string, value: any) => void;
  remove?: (id: string) => void;
}) {
  return (
    <div className="photo-grid">
      {photos.map((p, i) => (
        <article className="photo-item" key={`${p.id}-${i}`}>
          <img
            src={p.previews?.[p.fit] || p.url}
            alt={`Print preview: ${p.name}`}
            onError={(e) => {
              e.currentTarget.alt = "Photo no longer available";
            }}
          />
          <div className="photo-caption">
            <strong>{p.name}</strong>
            {remove && (
              <button
                aria-label={`Remove ${p.name}`}
                type="button"
                className="remove"
                onClick={() => remove(p.id)}
              >
                ×
              </button>
            )}
          </div>
          {p.lowResolution && (
            <p className="warning">Small photo: may look soft when printed.</p>
          )}
          {edit ? (
            <div className="photo-controls">
              <label>
                Framing
                <select
                  value={p.fit}
                  onChange={(e) => edit(p.id, "fit", e.target.value)}
                >
                  <option value="contain">Whole photo + border</option>
                  <option value="cover">Fill print (center crop)</option>
                </select>
              </label>
              <label>
                Copies
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={p.quantity}
                  onChange={(e) =>
                    edit(
                      p.id,
                      "quantity",
                      Math.max(1, Math.min(100, Number(e.target.value))),
                    )
                  }
                />
              </label>
            </div>
          ) : (
            <p className="small muted">
              {p.quantity} {p.quantity === 1 ? "print" : "prints"} ·{" "}
              {p.fit === "contain" ? "whole photo + border" : "center crop"}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
function OrderSummary({ quote: q }: { quote: any }) {
  return (
    <>
      <p className="eyebrow">YOUR LITTLE STACK</p>
      <h3>
        {q.items.reduce((n: number, i: any) => n + i.quantity, 0)} prints, a lot
        of feeling.
      </h3>
      <p className="muted">4 × 6 inches · {q.finish}</p>
      <dl className="price-list">
        <div>
          <dt>Photo prints</dt>
          <dd>{money(q.subtotal)}</dd>
        </div>
        <div>
          <dt>Home delivery</dt>
          <dd>{money(q.shipping)}</dd>
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
              <img src="/poppy.png" alt="" />
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
                  <a className="primary" href={order.checkoutUrl}>
                    Complete payment <Arrow />
                  </a>
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
              <PhotoGrid
                photos={order.quote.previews.map((p: any) => ({
                  ...p,
                  id: p.photoId,
                }))}
              />
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
      .catch(() => {});
  }, []);
  const route = window.location.pathname;
  return (
    <>
      <Header config={config} />
      {route === "/for-agents" ? (
        <Guide config={config} />
      ) : route === "/privacy" ? (
        <Privacy config={config} />
      ) : route === "/demo" ? (
        config.mode === "demo" ? (
          <Demo />
        ) : (
          <main className="document">
            <h1>Demo studio</h1>
            <p>
              {config.mode === "loading"
                ? "Loading…"
                : "The demo is only available in demo mode."}
            </p>
          </main>
        )
      ) : route.startsWith("/order/") ? (
        <OrderPage />
      ) : route.startsWith("/checkout/") ? (
        <OrderPage checkout />
      ) : route === "/" ? (
        <Home config={config} />
      ) : (
        <main className="document">
          <h1>A little lost?</h1>
          <a href="/">Back to Poppy →</a>
        </main>
      )}
      {route !== "/" && <Footer />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
