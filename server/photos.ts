import sharp from "sharp";
import fs from "node:fs/promises";
import { config } from "./config.js";
import { all, id, put, requireRecord, HttpError, mediaUrl } from "./store.js";
import type { Photo } from "./types.js";
export async function upload(buffer: Buffer, name: string, owner: string) {
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
  const p: Photo = {
    id: photoId,
    owner,
    name: name.replace(/[<>\x00-\x1f]/g, "").slice(0, 100) || "Photo",
    width,
    height,
    lowResolution:
      Math.min(width, height) < 1200 || Math.max(width, height) < 1800,
    created: Date.now(),
  };
  put("photo", photoId, p, owner);
  return photoView(p);
}
export function photoView(p: Photo) {
  return {
    ...p,
    owner: undefined,
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
