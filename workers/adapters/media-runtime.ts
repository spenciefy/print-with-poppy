import { runtime } from "../context.js";
import { HttpError } from "../../server/errors.js";
import type { media as nodeMedia } from "../../server/media-runtime.js";
async function processImage(path: string, body: BodyInit) {
  const namespace = runtime().env.MEDIA;
  const res = await namespace
    .get(namespace.idFromName("renderer"))
    .fetch(`http://container${path}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(60000),
    });
  const result = (await res.json()) as any;
  if (!res.ok)
    throw new HttpError(
      res.status,
      result.error || "render_unavailable",
      result.message || "Photo rendering unavailable. Retry the same request.",
    );
  result.files = Object.fromEntries(
    Object.entries(result.files as Record<string, string>).map(([k, v]) => [
      k,
      Buffer.from(v, "base64"),
    ]),
  );
  return result;
}
export const media: typeof nodeMedia = {
  normalize: (buffer) => processImage("/normalize", new Uint8Array(buffer)),
  async render(buffer, p, fit, product, color) {
    const result = await processImage(
      "/render",
      JSON.stringify({
        image: buffer.toString("base64"),
        width: p.width,
        height: p.height,
        fit,
        product,
        color,
      }),
    );
    return result.files;
  },
  async write(id, files) {
    const bucket = runtime().env.PHOTOS;
    const batch = crypto.randomUUID();
    for (const [name, data] of Object.entries(files)) {
      if (!/^[a-z-]+\.(jpg|png)$/.test(name))
        throw new Error("Invalid media variant.");
      await bucket.put(`staged/${id}/${batch}/${name}`, new Uint8Array(data), {
        httpMetadata: {
          contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
        },
      });
    }
    // Each variant has its own atomic pointer, so concurrent derivative batches cannot overwrite one another.
    // Upload metadata is committed only after all original/preview pointers are durable.
    for (const name of Object.keys(files))
      await bucket.put(
        `photos/${id}/${name}.json`,
        JSON.stringify({ key: `staged/${id}/${batch}/${name}` }),
      );
  },
  async read(id, name) {
    const bucket = runtime().env.PHOTOS;
    const index = await bucket.get(`photos/${id}/${name}.json`);
    if (!index) return null;
    const { key } = await index.json<{ key: string }>();
    const value = await bucket.get(key);
    return value ? Buffer.from(await value.arrayBuffer()) : null;
  },
  async remove(id, name) {
    const bucket = runtime().env.PHOTOS;
    const index = await bucket.get(`photos/${id}/${name}.json`);
    if (!index) return;
    const { key } = await index.json<{ key: string }>();
    await bucket.delete(key);
    await bucket.delete(`photos/${id}/${name}.json`);
  },
  async sample(url) {
    const res = await runtime().env.ASSETS.fetch(
      new Request(`${runtime().config.origin}${url}`),
    );
    if (!res.ok) throw new Error("Sample artwork unavailable.");
    return Buffer.from(await res.arrayBuffer());
  },
};
