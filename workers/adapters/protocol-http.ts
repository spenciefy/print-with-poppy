import { runtime } from "../context.js";
export { protocolUrl, publicAddress } from "../../server/protocol-url.js";
export async function protocolJson(url: string) {
  const namespace = runtime().env.PROTOCOL;
  const res = await namespace
    .get(namespace.idFromName("metadata"))
    .fetch("http://container/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    });
  if (!res.ok) throw new Error("Protocol metadata unavailable.");
  return res.json();
}
