import fs from "node:fs/promises";
import { config } from "./config.js";
import { normalizePhoto, renderPhoto } from "./media-pipeline.js";
export const media = {
  normalize: normalizePhoto,
  render: renderPhoto,
  async write(id: string, files: Record<string, Buffer>) {
    for (const [name, data] of Object.entries(files))
      await fs.writeFile(`${config.dataDir}/photos/${id}-${name}`, data, {
        mode: 0o600,
      });
  },
  async read(id: string, name: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(`${config.dataDir}/photos/${id}-${name}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  async remove(id: string, name: string) {
    await fs.rm(`${config.dataDir}/photos/${id}-${name}`, { force: true });
  },
  async sample(url: string) {
    return fs.readFile(`${process.cwd()}/public${url}`);
  },
};
