import { build } from "esbuild";
import path from "node:path";
import { mkdir } from "node:fs/promises";
await mkdir(".cloudflare/containers", { recursive: true });
const replacements = {
  "store.ts": "server/store-core.ts",
  "config.ts": "workers/adapters/config.ts",
  "media-runtime.ts": "workers/adapters/media-runtime.ts",
  "protocol-http.ts": "workers/adapters/protocol-http.ts",
  "environment.ts": "workers/adapters/environment.ts",
  "stripe-client.ts": "workers/adapters/stripe-client.ts",
  "worker.ts": "workers/adapters/worker.ts",
};
await build({
  entryPoints: ["workers/app.ts"],
  outfile: ".cloudflare/worker.mjs",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  packages: "bundle",
  external: ["node:*", "cloudflare:*"],
  conditions: ["workerd", "worker", "browser"],
  plugins: [
    {
      name: "platform-adapters",
      setup(b) {
        b.onResolve({ filter: /\.(js|ts)$/ }, (args) => {
          if (!args.path.startsWith(".")) return;
          const full = path
            .resolve(args.resolveDir, args.path)
            .replace(/\.js$/, ".ts");
          if (path.dirname(full) !== path.resolve("server")) return;
          const replacement = replacements[path.basename(full)];
          if (replacement) return { path: path.resolve(replacement) };
        });
      },
    },
  ],
});
await build({
  entryPoints: ["containers/media/server.ts"],
  outfile: ".cloudflare/containers/media.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["sharp"],
});
await build({
  entryPoints: ["containers/protocol-fetch/server.ts"],
  outfile: ".cloudflare/containers/protocol.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});
