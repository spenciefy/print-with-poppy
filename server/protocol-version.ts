import { parseList } from "http-structured-fields";
import { HttpError } from "./errors.js";

export const protocolVersion = "0.4";
export const operationsVersion = "3";

/** 0.4 §3.4: malformed extension lists declare no extensions. Unknown entries are ignored. */
export function requestVersions(version: string | undefined, extensions: string | undefined) {
  if (version !== protocolVersion)
    throw new HttpError(400, "version_unsupported", "Discover /.well-known/poppy.json and send Poppy-Version: 0.4 in a new Session.");
  let operations = false;
  try {
    const entries = parseList(extensions || "");
    operations = entries.some(entry => entry.type === "item" && entry.value.type === "string" &&
      entry.value.value === "operations" && entry.parameters.get("v")?.type === "string" &&
      entry.parameters.get("v")?.value === operationsVersion);
  } catch { /* An invalid list declares nothing. */ }
  return { protocolVersion: version, extensions: operations };
}
