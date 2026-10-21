import { media } from "./media-runtime.js";
import { z } from "zod";
import { upload } from "./photos.js";

export const samplePhotos = [
  { color: "yellow", name: "Yellow poppies", url: "/photos/poppy-abstract-yellow.webp" },
  { color: "orange", name: "Orange poppies", url: "/photos/poppy-abstract-cluster.webp" },
  { color: "red", name: "Red poppies", url: "/photos/poppy-abstract-red.webp" },
] as const;

const selection = z.object({ color: z.enum(["yellow", "orange", "red"]) }).strict();

export async function addSamplePhoto(body: unknown, owner: string) {
  const { color } = selection.parse(body);
  const sample = samplePhotos.find(photo => photo.color === color)!;
  // Only bundled artwork; never fetch agent-supplied URLs or filesystem paths.
  const buffer = await media.sample(sample.url);
  return { ...await upload(buffer, sample.name, owner), sampleColor: color };
}
