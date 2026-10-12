import React, { useEffect, useRef, useState } from "react";
import { products, printSubtotal, posterPrice, shippingPrice } from "./offer";
import "./demo.css";
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const photos = ["cluster", "red", "yellow"];
const stages = [
  "Share photos",
  "Choose prints",
  "Approve",
  "Payment",
  "Confirmation",
];
function PhotoStrip() {
  return (
    <div className="demo-photos">
      {photos.map((p) => (
        <img
          key={p}
          src={`/photos/poppy-abstract-${p}.webp`}
          alt={`${p === "cluster" ? "Orange" : p} poppy artwork`}
        />
      ))}
    </div>
  );
}
export default function Demo() {
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [product, setProduct] = useState<"prints" | "poster">("prints");
  const [detail, setDetail] = useState<"journey" | "order" | "email">(
    "journey",
  );
  const scroll = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    if (detail !== "journey" && window.matchMedia("(max-width: 760px)").matches)
      inspector.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }, [detail]);
  const selected = products[product];
  const subtotal = product === "prints" ? printSubtotal(3) : posterPrice;
  const shipping = shippingPrice(subtotal),
    total = subtotal + shipping;
  const count = product === "prints" ? 3 : 1;
  const gate = step === 2 || step === 6;
  const finished = step === 11;
  const phase = step < 2 ? 0 : step < 6 ? 1 : step < 8 ? 2 : step < 9 ? 3 : 4;
  useEffect(() => {
    if (!playing || gate || finished) return;
    const timer = window.setTimeout(
      () => setStep((s) => s + 1),
      step < 0 ? 150 : step === 8 ? 2200 : 1900,
    );
    return () => clearTimeout(timer);
  }, [playing, step, gate, finished]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [step]);
  function restart() {
    setStep(-1);
    setPlaying(false);
    setProduct("prints");
    setDetail("journey");
  }
  function choose(value: "prints" | "poster") {
    setProduct(value);
    setStep(3);
    setPlaying(true);
  }
  const receipt = (
    <>
      <div className="demo-receipt-product">
        <img src={selected.emailImage} alt="Sample poppy print" />
        <div>
          <strong>{selected.label}</strong>
          <small>
            {selected.dimensions} · {selected.finish}
          </small>
          <small>Quantity: {count} · Edge-to-edge</small>
        </div>
      </div>
      <dl className="demo-totals">
        <div>
          <dt>Prints</dt>
          <dd>{money(subtotal)}</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>{shipping ? money(shipping) : "Included"}</dd>
        </div>
        <div>
          <dt>Tax (example)</dt>
          <dd>$0.00</dd>
        </div>
        <div className="demo-total">
          <dt>Total · USD</dt>
          <dd>{money(total)}</dd>
        </div>
      </dl>
    </>
  );
  const address = (
    <p className="demo-address">
      Alex Taylor
      <br />
      123 Example Street, Apt 4<br />
      San Francisco, CA 94103
      <br />
      alex@example.com
    </p>
  );
  const messages: { side: "you" | "agent"; content: React.ReactNode }[] = [
    {
      side: "you",
      content: (
        <>
          <PhotoStrip />
          <p>
            I want to order these photos from Print with Poppy using Personal
            Agent Protocol.
          </p>
        </>
      ),
    },
    {
      side: "agent",
      content: (
        <p>
          I’ll read the store’s{" "}
          <a href="/.well-known/poppy.json" target="_blank" rel="noreferrer">
            poppy.json
          </a>{" "}
          and API reference, then check the print options.
        </p>
      ),
    },
    {
      side: "agent",
      content: (
        <>
          <p>
            Three 4×6 prints are $12, plus $5 shipping. Or choose one photo for
            a 12×16 poster at $35, with shipping included.
          </p>
          <small>Tax is shown before approval. Which would you like?</small>
          {step === 2 && (
            <div className="demo-choices">
              <button onClick={() => choose("prints")}>
                3 photo prints <span>$12</span>
              </button>
              <button onClick={() => choose("poster")}>
                1 red poppy poster <span>$35</span>
              </button>
            </div>
          )}
        </>
      ),
    },
    {
      side: "you",
      content: (
        <p>
          {product === "prints"
            ? "One print of each, please. Fill the frame."
            : "The red poppy as a poster, please. Fill the frame."}
        </p>
      ),
    },
    {
      side: "agent",
      content: (
        <p>
          I’ve prepared the photo upload. I’ll use a center crop to fill the
          paper, with no white margins. What delivery address and email should I
          use?
        </p>
      ),
    },
    {
      side: "you",
      content: (
        <>
          {address}
          <small>Fictional details for this demo.</small>
        </>
      ),
    },
    {
      side: "agent",
      content: (
        <>
          <p>Here’s the order for your approval.</p>
          <div className="demo-crops">
            {(product === "prints" ? photos : ["red"]).map((p) => (
              <img
                className={product}
                key={p}
                src={`/photos/poppy-abstract-${p}.webp`}
                alt={`${p} artwork cropped to the print size`}
              />
            ))}
          </div>
          {receipt}
          {address}
          <small>
            Estimated delivery: 7–12 business days after payment. Not
            guaranteed. Payment sends the order to production; cancellation may
            not be possible.
          </small>
          {step === 6 && (
            <button
              className="demo-approve"
              onClick={() => {
                setStep(7);
                setPlaying(true);
              }}
            >
              Approve simulated order · {money(total)}
            </button>
          )}
        </>
      ),
    },
    {
      side: "you",
      content: <p>Approved. Pay {money(total)} with my authorized card.</p>,
    },
    {
      side: "agent",
      content: (
        <>
          <p>
            I’m confirming the approved order and completing its Stripe
            checkout.
          </p>
          <div className="demo-payment">
            <span aria-hidden="true">▭</span>
            <div>
              <strong>Simulated card payment</strong>
              <small>No card details. No charge.</small>
            </div>
            <b>{money(total)}</b>
          </div>
        </>
      ),
    },
    {
      side: "agent",
      content: (
        <>
          <p>Your print order has been placed.</p>
          <div className="demo-complete">
            <span aria-hidden="true">✓</span>Payment confirmed · sent to the
            print lab
          </div>
          <button className="demo-link" onClick={() => setDetail("order")}>
            View example order <span aria-hidden="true">↗</span>
          </button>
          <small>Simulated result — nothing is being printed.</small>
        </>
      ),
    },
    { side: "you", content: <p>Can I see the confirmation email?</p> },
    {
      side: "agent",
      content: (
        <>
          <p>
            Here it is. The store sends a confirmation after payment, then a
            shipping update when the printer reports dispatch.
          </p>
          <button className="demo-link" onClick={() => setDetail("email")}>
            Open example email <span aria-hidden="true">↗</span>
          </button>
          <small>Demo complete. No order placed or email sent.</small>
        </>
      ),
    },
  ];
  return (
    <main className="poppy-demo">
      <div className="demo-intro">
        <div>
          <a href="/" className="demo-back">
            ← Back to the store
          </a>
          <h1>From chat to your doorstep.</h1>
          <p>See how a personal agent orders your prints.</p>
        </div>
        <span className="demo-badge">Interactive demo · no real purchase</span>
      </div>
      <div className="demo-workspace">
        <section
          className="demo-phone"
          aria-label="Personal agent conversation"
        >
          <div className="demo-chat-header">
            <span className="demo-avatar" aria-hidden="true">
              ✳
            </span>
            <div>
              <strong>Your personal agent</strong>
              <small>A scripted conversation</small>
            </div>
            <button
              onClick={restart}
              aria-label="Restart demo"
              title="Restart demo"
            >
              ↺
            </button>
          </div>
          <div
            className="demo-conversation"
            ref={scroll}
            role="log"
            aria-label="Demo messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {step < 0 && (
              <div className="demo-empty">
                <div className="demo-photo-stack">
                  <img src="/photos/poppy-abstract-red.webp" alt="" />
                  <img src="/photos/poppy-abstract-yellow.webp" alt="" />
                  <img
                    src="/photos/poppy-abstract-cluster.webp"
                    alt="Orange poppy photo print"
                  />
                </div>
                <h2>
                  A few photos.
                  <br />
                  One conversation.
                </h2>
                <p>
                  You choose the prints.
                  <br />
                  Your agent takes care of the steps.
                </p>
                <button className="demo-start" onClick={() => setPlaying(true)}>
                  ▶ Play demo
                </button>
              </div>
            )}
            {messages.slice(0, step + 1).map((m, i) => (
              <div
                className={`demo-message ${m.side}`}
                key={`${i}-${i > 2 ? product : ""}`}
              >
                <span className="demo-speaker">
                  {m.side === "you" ? "You" : "Agent"}
                </span>
                <div className="demo-bubble">{m.content}</div>
              </div>
            ))}
            {playing && !gate && !finished && step >= 0 && (
              <div className="demo-typing" aria-label="Next message arriving">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="demo-controls">
            <button
              onClick={() => (finished ? restart() : setPlaying((p) => !p))}
              disabled={gate}
            >
              {finished ? "Replay" : playing ? "Pause" : "Play"}
            </button>
            <span>
              {gate
                ? "Your turn — choose above"
                : finished
                  ? "That’s the full flow"
                  : step < 0
                    ? "About a minute"
                    : `${stages[phase]} · ${phase + 1} of 5`}
            </span>
            <button
              onClick={() => {
                setPlaying(false);
                setStep((s) => Math.min(s + 1, 11));
              }}
              disabled={gate || finished}
              aria-label="Next message"
            >
              Next →
            </button>
          </div>
        </section>
        <aside className="demo-inspector" ref={inspector}>
          <div className="demo-tabs" role="group" aria-label="Demo details">
            <button
              aria-pressed={detail === "journey"}
              onClick={() => setDetail("journey")}
            >
              How it works
            </button>
            <button
              disabled={step < 9}
              aria-pressed={detail === "order"}
              onClick={() => setDetail("order")}
            >
              Order
            </button>
            <button
              disabled={step < 11}
              aria-pressed={detail === "email"}
              onClick={() => setDetail("email")}
            >
              Email
            </button>
          </div>
          {detail === "journey" ? (
            <div className="demo-journey">
              <h2>A store your agent can use.</h2>
              <p>
                The conversation is simulated. These are the steps a real agent
                follows.
              </p>
              <ol>
                {[
                  "Discover the store through poppy.json and its API reference.",
                  "Upload photos and choose a product from the catalog.",
                  "Present crops, address, email and the full total for approval.",
                  "Confirm that revision, then pay through hosted Stripe checkout.",
                  "Check order status. The store emails confirmation and shipping updates.",
                ].map((s, i) => (
                  <li
                    key={s}
                    data-active={i === phase && step >= 0}
                    data-done={i < phase && step >= 0}
                  >
                    <span>{i < phase && step >= 0 ? "✓" : i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              <a href="/docs" target="_blank" rel="noreferrer">
                Explore the real API ↗
              </a>
              <p className="demo-footnote">
                Native agents authenticate using Poppy. Agents without Poppy
                support can use the store’s guest API. This demo calls neither
                purchase flow.
              </p>
            </div>
          ) : (
            <div className="demo-document" key={detail}>
              <div className="demo-document-label">
                {detail === "email"
                  ? "Email preview · not sent"
                  : "Order preview · not placed"}
              </div>
              {detail === "email" && (
                <div className="demo-mail-meta">
                  <span>From: Print with Poppy</span>
                  <span>To: alex@example.com</span>
                </div>
              )}
              <img
                className="demo-doc-logo"
                src="/photos/poppy-email-logo.png"
                alt="Print with Poppy"
              />
              <h2>Your print order has been placed.</h2>
              <p>
                {detail === "email"
                  ? "We received your payment. Your photos are queued for printing."
                  : "Payment received. Submitted to the print lab."}
              </p>
              {receipt}
              <h3>Delivering to</h3>
              {address}
              <p>
                Estimated delivery: 7–12 business days after payment. This is an
                estimate, not a guaranteed date.
              </p>
              {detail === "order" && (
                <p className="demo-shipping-note">
                  Not yet shipped. Carrier and tracking will appear when
                  supplied by the printer.
                </p>
              )}
              <small>
                Example order DEMO-POPPY · No charge or fulfillment.
              </small>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
