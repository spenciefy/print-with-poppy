import { createServer } from "node:http";
import { normalizePhoto, renderPhoto } from "../../server/media-pipeline.js";
import { z } from "zod";
import sharp from "sharp";
sharp.concurrency(1);
sharp.cache(false);
let busy = false;
const render = z
  .object({
    image: z.string().max(30_000_000),
    width: z.number().int().min(300).max(6000),
    height: z.number().int().min(300).max(6000),
    fit: z.enum(["contain", "cover"]),
    product: z.enum([
      "prints",
      "square",
      "enlargement",
      "poster",
      "mug",
      "tshirt",
    ]),
    color: z.string().optional(),
  })
  .strict();
createServer(async (req, res) => {
  if (req.url === "/health") {
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || !["/normalize", "/render"].includes(req.url!)) {
    res.writeHead(404).end();
    return;
  }
  if (busy) {
    res.writeHead(503).end();
    return;
  }
  busy = true;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32_000_000)
        throw Object.assign(new Error("Image too large."), {
          status: 413,
          code: "upload_limit",
        });
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks);
    let result: any;
    if (req.url === "/normalize") {
      if (input.length > 20 * 1024 * 1024)
        throw Object.assign(new Error("Upload one photo, up to 20 MB."), {
          status: 413,
          code: "upload_limit",
        });
      result = await normalizePhoto(input);
    } else {
      const body = render.parse(JSON.parse(input.toString()));
      result = {
        files: await renderPhoto(
          Buffer.from(body.image, "base64"),
          body,
          body.fit,
          body.product,
          body.color,
        ),
      };
    }
    const files = Object.fromEntries(
      Object.entries(result.files as Record<string, Buffer>).map(([k, v]) => [
        k,
        v.toString("base64"),
      ]),
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ...result, files }));
  } catch (e: any) {
    res
      .writeHead(e.status || 422, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({
          error: e.code || "invalid_image",
          message: e.status ? e.message : "Unable to process this image.",
        }),
      );
  } finally {
    busy = false;
  }
}).listen(8080, "0.0.0.0");
