import { productOf, mediaVariant, previewVariant, shirtColors, shirtPath, type Product } from "../src/offer.js";
import { media } from "./media-runtime.js";
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
  const { width, height, files } = await media.normalize(buffer);
  await media.write(photoId, files);
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

export async function preparePoster(p: Photo, fit: "contain" | "cover", product: Product = "poster", color?: string) {
  const source = await media.read(p.id, "original.jpg");
  if (!source) throw new HttpError(422, "reupload_required", "Upload this photo again to prepare the larger print.");
  await media.write(p.id, await media.render(source, p, fit, product, color));
}

/**
 * Copy an account order's photo into the current session for a reorder. Photos stay
 * session-owned; the copy shares no record with the original and follows the same
 * retention policy. Returns 410 photo_expired once retention has removed the source.
 */
export async function clonePhoto(sourceId: string, owner: string) {
  const source = get<Photo>("photo", sourceId);
  const expired = () =>
    new HttpError(
      410,
      "photo_expired",
      "The photos from this order are no longer stored. Upload them again to order more prints.",
    );
  if (!source || source.deleted) throw expired();
  if (all<Photo>("photo", owner).filter((p) => !p.deleted).length >= 100)
    throw new HttpError(429, "photo_limit", "Maximum 100 stored photos per session.");
  const files: Record<string, Buffer> = {};
  for (const name of ["original.jpg", "contain.jpg", "cover.jpg"]) {
    const file = await media.read(source.id, name);
    if (!file) throw expired();
    files[name] = file;
  }
  const photoId = id("photo");
  await media.write(photoId, files);
  const p: Photo = {
    id: photoId,
    owner,
    name: `Photo ${all<Photo>("photo", owner).length + 1}`,
    width: source.width,
    height: source.height,
    lowResolution: source.lowResolution,
    created: Date.now(),
  };
  put("photo", photoId, p, owner);
  return p;
}
export function photosAvailable(photoIds: string[]) {
  return photoIds.every((photoId) => {
    const p = get<Photo>("photo", photoId);
    return !!p && !p.deleted;
  });
}
