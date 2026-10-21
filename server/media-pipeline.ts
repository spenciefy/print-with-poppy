import sharp from "sharp";
import {
  productOf,
  mediaVariant,
  previewVariant,
  shirtColors,
  shirtPath,
  type Product,
} from "../src/offer.js";
import { HttpError } from "./errors.js";
export async function normalizePhoto(buffer: Buffer) {
  const image = sharp(buffer, { limitInputPixels: 40000000, failOn: "error" });
  let meta;
  try {
    meta = await image.metadata();
  } catch {
    throw new HttpError(
      422,
      "invalid_image",
      "Upload a valid JPEG, PNG, or WebP photo.",
    );
  }
  if (!["jpeg", "png", "webp"].includes(meta.format || ""))
    throw new HttpError(
      422,
      "invalid_image",
      "Please convert this image to JPEG, PNG, or WebP first.",
    );
  const normalized = await image
    .rotate()
    .resize({
      width: 6000,
      height: 6000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toBuffer();
  const dimensions = await sharp(normalized).metadata();
  const width = dimensions.width!,
    height = dimensions.height!;
  if (Math.min(width, height) < 300)
    throw new HttpError(
      422,
      "image_too_small",
      "Photo must be at least 300 pixels on its shortest side.",
    );
  const [w, h] = width >= height ? [1800, 1200] : [1200, 1800];
  const files: Record<string, Buffer> = { "original.jpg": normalized };
  for (const fit of ["contain", "cover"] as const) {
    files[`${fit}.jpg`] = await sharp(normalized)
      .resize(w, h, { fit, position: "centre", background: "#ffffff" })
      .jpeg({ quality: 95 })
      .toBuffer();
  }
  return { width, height, files };
}
export async function renderPhoto(
  source: Buffer,
  p: { width: number; height: number },
  fit: "contain" | "cover",
  product: Product,
  color?: string,
): Promise<Record<string, Buffer>> {
  if (product === "tshirt") {
    const art = await sharp(source)
      .resize(4680, 5790, {
        fit,
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const fill = shirtColors[color as keyof typeof shirtColors];
    if (!fill)
      throw new HttpError(
        400,
        "invalid_color",
        "Choose a supported T-shirt color.",
      );
    const base = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="760"><rect width="700" height="760" fill="#f7f3ec"/><path d="${shirtPath}" fill="${fill}" stroke="#b4aaa0" stroke-width="2"/><path d="M290 65 Q350 150 410 65" fill="none" stroke="#b4aaa0" stroke-width="2"/><text x="350" y="720" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#635c55">Front preview · approximate color and placement</text></svg>`,
    );
    // Same complete print-area artwork as fulfillment, scaled proportionally onto the shirt.
    const print = await sharp(art).resize(220, 272).png().toBuffer();
    const preview = await sharp(base)
      .composite([{ input: print, left: 240, top: 210 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    return {
      [`tshirt-${fit}.png`]: art,
      [`${previewVariant(product, fit, color)}.jpg`]: preview,
    };
  }
  const spec = productOf({ product });
  const [w, h] =
    product === "mug" || p.width >= p.height
      ? [spec.longPixels, spec.shortPixels]
      : [spec.shortPixels, spec.longPixels];
  const output = await sharp(source)
    .resize(w, h, { fit, position: "centre", background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toBuffer();
  return { [`${mediaVariant(product, fit)}.jpg`]: output };
}
