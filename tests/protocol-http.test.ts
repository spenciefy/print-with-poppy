import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicAddress,
  protocolUrl,
  protocolJson,
} from "../server/protocol-http.js";

test("protocol destinations exclude local, private, mapped and transition addresses", () => {
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true, address);
  for (const url of [
    "http://agent.example/client.json",
    "https://user:secret@agent.example/",
    "https://127.1/",
    "https://[::1]/",
    "https://[::ffff:7f00:1]/",
    "https://localhost/",
    "https://a.localhost/",
    "https://agent.example/#fragment",
  ])
    assert.throws(() => protocolUrl(url), url);
  assert.equal(
    protocolUrl("https://agent.example/client.json").hostname,
    "agent.example",
  );
});

test("DNS resolution of an allowlisted-looking host cannot reach loopback", async () => {
  // localhost. is deliberately resolved (not matched by the literal hostname guard).
  await assert.rejects(
    protocolJson("https://localhost./client.json"),
    /Private protocol destination/,
  );
});
