import { test } from "node:test";
import assert from "node:assert/strict";
import { retrying } from "../scripts/http-retry.js";
test("429 retries rebuild proofs and honor seconds and date Retry-After without capping", async () => {
  for (const header of ["125", "Thu, 01 Jan 1970 00:02:05 GMT"]) {
    let calls = 0;
    let waited = 0;
    const response = await retrying(async () => {
      calls++;
      return new Response(null, { status: calls === 1 ? 429 : 200, headers: { "Retry-After": header } });
    }, { now: () => 0, sleep: async (ms) => { waited += ms; } });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(waited, 125000);
  }
});
test("retry budget is bounded; uncertain server failures never repeat a write", async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const response = await retrying(async () => { calls++; return new Response(null, { status }); }, { attempts: 3, sleep: async () => {} });
    assert.equal(response.status, status);
    assert.equal(calls, status === 429 ? 3 : 1);
  }
});
