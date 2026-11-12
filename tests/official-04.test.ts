import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { poppyAgent } from "../scripts/poppy-delegation.js";
import { generateKey, decodeJwt } from "./vendor/poppy-0.4/jose.js";
import { officialSchema } from "./support/official-schema.js";

test("vendored official 0.4 kit matches upstream bytes", async () => {
  const directory = new URL("./vendor/poppy-0.4/", import.meta.url);
  const hashes = JSON.parse(await fs.readFile(new URL("SHA256.json", directory), "utf8"));
  for (const [name, hash] of Object.entries(hashes))
    assert.equal(createHash("sha256").update(await fs.readFile(new URL(name, directory))).digest("hex"), hash, name);
});

test("reference-client proofs pass independent official schemas (regression for #35)", async () => {
  const root = await generateKey(true);
  const agent = await poppyAgent({ ...root.privateJwk, kid: "root" }, "https://agent.example/client.json", "https://store.example");
  const session = agent.newSession("opaque-user");
  for (const token of [undefined, "test-access-token"]) {
    const decoded = decodeJwt(await agent.sessionJwt(session, "GET", "https://store.example/api/account", token));
    officialSchema("session-jwt", decoded);
    officialSchema("delegation", decodeJwt(decoded.header.poppy_dlg as string));
    const old = structuredClone(decoded);
    old.header.pap_dlg = old.header.poppy_dlg;
    delete old.header.poppy_dlg;
    assert.throws(() => officialSchema("session-jwt", old));
  }
});

test("published discovery and OAuth metadata pass official 0.4 schemas", async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/official-poppy-`);
  process.env.APP_MODE = "demo";
  process.env.DATA_DIR = dir;
  process.env.PUBLIC_URL = "https://store.example";
  process.env.NO_LISTEN = "1";
  const { app } = await import("../server/index.js");
  const store = await import("../server/store.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const port = (server.address() as any).port;
    for (const [path, schema] of [
      ["/.well-known/poppy.json", "poppy"],
      ["/.well-known/oauth-authorization-server", "authorization-server-metadata"],
      ["/.well-known/oauth-protected-resource", "protected-resource-metadata"],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200);
      officialSchema(schema, await response.json());
    }
    const api = await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).text();
    assert(api.includes("poppy_dlg") && api.includes("poppy-delegation+jwt"));
    assert(!api.includes("pap_dlg") && !api.includes("pap-delegation+jwt"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
