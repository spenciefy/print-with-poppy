import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../server/config-values.js";
import { protocolAddressAllowed, protocolUrl } from "../server/protocol-url.js";
import { configuration } from "../workers/configuration.js";
const grid = {
  APP_MODE: "demo",
  PUBLIC_URL: "https://pwp.company.interop.test",
  ALLOW_INTEROP_TEST_HOSTS: "true",
  AGENT_SANDBOX: "true",
  ALLOW_COMPAT_AGENT_SESSIONS: "false",
};
test("interop exception is explicit and limited to isolated simulated configuration", () => {
  assert.equal(parseConfig({}).interopTestHosts, false);
  assert.equal(parseConfig(grid).interopTestHosts, true);
  for (const extra of [
    { APP_MODE: "live" },
    { APP_MODE: "sandbox" },
    { PUBLIC_URL: "https://sandbox.printwithpoppy.com" },
    { PUBLIC_URL: "https://printwithpoppy.com" },
    { PUBLIC_URL: "http://pwp.company.interop.test" },
    { PUBLIC_URL: "https://interop.test.attacker.com" },
    { CF_DEPLOYMENT: "sandbox" },
    { SANDBOX_EMAIL_DELIVERY: "true" },
    { STRIPE_SECRET_KEY: "test" },
    { PRODIGI_API_KEY: "test" },
    { RESEND_API_KEY: "test" },
    { ALLOW_INTEROP_TEST_HOSTS: "1" },
  ])
    assert.throws(
      () => parseConfig({ ...grid, ...extra }),
      /ALLOW_INTEROP_TEST_HOSTS/,
    );
  assert.throws(() => configuration(grid), /never Cloudflare/);
});
test("only grid names may connect to private subnets; loopback and metadata remain blocked", () => {
  const host = "pda.agent.interop.test";
  for (const ip of ["10.1.2.3", "172.19.0.2", "192.168.5.2", "fd00::2"]) {
    assert.equal(protocolAddressAllowed(host, ip, true), true);
    assert.equal(protocolAddressAllowed(host, ip), false);
    for (const name of [
      "other.test",
      "interop.test",
      "pda.interop.test.evil.com",
      "172.19.0.2",
      "pda.example.com",
    ])
      assert.equal(protocolAddressAllowed(name, ip, true), false);
  }
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
  ])
    assert.equal(protocolAddressAllowed(host, ip, true), false);
  assert.throws(() => protocolUrl("http://pda.agent.interop.test/client.json"));
  assert.throws(() => protocolUrl("https://172.19.0.2/client.json"));
});
