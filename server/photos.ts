import { productOf, mediaVariant, type Product } from "../src/offer.js";
import sharp from "sharp";
import fs from "node:fs/promises";
import { config } from "./config.js";
import { all, get, id, put, requireRecord, HttpError, mediaUrl } from "./store.js";
import type { Photo } from "./types.js";
export async function upload(buffer: Buffer, _name: string, owner: string) {
  if (all<Photo>("photo", owner).filter((p) => !p.deleted).length >= 100)
    throw new HttpError(
      429,
      "photo_limit",
      "Maximum 100 stored photos per session.",
    );
  const photoId = id("photo");
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
  for (const fit of ["contain", "cover"] as const) {
    const output = await sharp(normalized)
      .resize(w, h, { fit, position: "centre", background: "#ffffff" })
      .jpeg({ quality: 95 })
      .toBuffer();
    await fs.writeFile(
      `${config.dataDir}/photos/${photoId}-${fit}.jpg`,
      output,
      { mode: 0o600 },
    );
  }
  await fs.writeFile(
    `${config.dataDir}/photos/${photoId}-original.jpg`,
    normalized,
    { mode: 0o600 },
  );
  const p: Photo = {
    id: photoId,
    owner,
    name: `Photo ${all<Photo>("photo", owner).length + 1}`,
    width,
    height,
    lowResolution:
      Math.min(width, height) < 1200 || Math.max(width, height) < 1800,
    created: Date.now(),
  };
  put("photo", photoId, p, owner);
  return photoView(p);
}
export function photoLabel(photoId: string, fallbackIndex = 0) {
  const p = get<Photo>("photo", photoId);
  if (!p) return `Photo ${fallbackIndex + 1}`;
  if (/^Photo [1-9][0-9]*$/.test(p.name)) return p.name;
  const index = all<Photo>("photo", p.owner).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)).findIndex(photo => photo.id === photoId);
  return `Photo ${index + 1}`;
}
export function photoView(p: Photo) {
  return {
    ...p,
    owner: undefined,
    name: photoLabel(p.id),
    previews: {
      contain: mediaUrl(p.id, "contain"),
      cover: mediaUrl(p.id, "cover"),
    },
  };
}
export function ownedPhoto(photoId: string, owner: string) {
  const p = requireRecord<Photo>("photo", photoId, owner);
  if (p.deleted)
    throw new HttpError(
      410,
      "photo_expired",
      "This photo has expired. Upload it again.",
    );
  return p;
}

export async function preparePoster(p: Photo, fit: "contain" | "cover", product: Product = "poster") {
  const source = `${config.dataDir}/photos/${p.id}-original.jpg`;
  try {
    await fs.access(source);
  } catch {
    throw new HttpError(
      422,
      "reupload_required",
      "Upload this photo again to prepare the larger print.",
    );
  }
  const spec = productOf({ product });
  const [w, h] = p.width >= p.height ? [spec.longPixels, spec.shortPixels] : [spec.shortPixels, spec.longPixels];
  await sharp(source)
    .resize(w, h, { fit, position: "centre", background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toFile(`${config.dataDir}/photos/${p.id}-${mediaVariant(product, fit)}.jpg`);
}
