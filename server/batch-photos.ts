import { HttpError } from "./errors.js";

export const batchFields = Array.from(
  { length: 10 },
  (_, i) => `photo${i + 1}`,
);
export const batchBytes = 20 * 1024 * 1024;
export const batchBodyLimit = batchBytes + 65536;

export async function parsePhotoBatch(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength > batchBodyLimit)
    throw new HttpError(
      413,
      "upload_limit",
      "Upload at most 20 MB of photos per batch.",
    );
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new HttpError(
      400,
      "invalid_request",
      "Send photos as multipart/form-data.",
    );
  }
  const entries = [...form.entries()];
  const seen = new Set<string>();
  let total = 0;
  if (!entries.length || entries.length > 10)
    throw new HttpError(
      400,
      "photo_required",
      "Attach 1–10 photos using photo1 through photo10.",
    );
  const files = entries.map(([field, file]) => {
    if (
      !batchFields.includes(field) ||
      seen.has(field) ||
      typeof file === "string" ||
      !file.size
    )
      throw new HttpError(
        400,
        "invalid_request",
        "Use each photo1 through photo10 field at most once, with a nonempty file.",
      );
    seen.add(field);
    total += file.size;
    return { field, file };
  });
  if (total > batchBytes)
    throw new HttpError(
      413,
      "upload_limit",
      "Upload at most 20 MB of photos per batch.",
    );
  return files.sort(
    (a, b) => batchFields.indexOf(a.field) - batchFields.indexOf(b.field),
  );
}

export async function processPhotoBatch<T>(
  files: { field: string; file: File }[],
  upload: (file: File, index: number) => Promise<T>,
) {
  const results = [];
  for (const [index, { field, file }] of files.entries()) {
    try {
      results.push({
        field,
        status: "uploaded",
        photo: await upload(file, index),
      });
    } catch (error) {
      results.push({
        field,
        status: "failed",
        error: error instanceof HttpError ? error.code : "upload_failed",
        message:
          error instanceof HttpError
            ? error.message
            : "This photo could not be uploaded. Retry only this photo.",
      });
    }
  }
  return {
    results,
    uploaded: results.filter((r) => r.status === "uploaded").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}
