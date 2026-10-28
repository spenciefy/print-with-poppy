import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
const origin = "http://localhost:8899";
let createdVars = false;
try {
  await fs.writeFile(
    ".dev.vars",
    `APP_SECRET=${randomBytes(48).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  createdVars = true;
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}

const root = await fs.mkdtemp(path.resolve(".cloudflare/runtime-test-"));
const log = await fs.open(root + "/wrangler.log", "w");
const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    "8899",
    "--persist-to",
    root + "/state",
    "--var",
    `PUBLIC_URL:${origin}`,
    ...(process.env.RUNTIME_SKIP_MEDIA === "1" ? ["--enable-containers=false"] : []),
  ],
  { stdio: ["ignore", log.fd, log.fd] },
);
async function run(args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.once("error", reject);
    p.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Test exited ${code}`)),
    );
  });
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      ready = (await fetch(origin + "/api/health")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready)
    throw new Error(`Worker failed to start. Inspect ${root}/wrangler.log`);
  const dir = root + "/state/v3/do/pwp-cf-local-CommerceState";
  let privateKey;
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith(".sqlite") || file === "metadata.sqlite") continue;
    const db = new Database(dir + "/" + file, { readonly: true });
    const row = db
      .prepare(
        "SELECT body FROM records WHERE kind='demo-key' AND id='identity'",
      )
      .get();
    db.close();
    if (row) privateKey = JSON.parse(row.body).private;
  }
  if (!privateKey) throw new Error("Local demo identity missing.");
  const privateFile = root + "/identity.json";
  await fs.writeFile(privateFile, JSON.stringify(privateKey), { mode: 0o600 });
  const env = {
    PUBLIC_URL: origin,
    AGENT_PRIVATE_JWK_FILE: privateFile,
    AGENT_CLIENT_ID: origin + "/api/demo/agent.json",
    SANDBOX_TEST_EMAIL: "runtime@example.com",
  };
  await run(["tsx", "tests/cloudflare/runtime.ts"], env);
  // The reference agent orders photos, which needs the media containers.
  if (process.env.RUNTIME_SKIP_MEDIA !== "1") await run(
    [
      "tsx",
      "scripts/agent.ts",
      "--approve-demo",
      "--sandbox-account",
      "--tshirt",
      "--revoke-demo",
    ],
    env,
  );
} finally {
  child.kill("SIGTERM");
  await log.close();
  if (createdVars) await fs.unlink(".dev.vars");
}
