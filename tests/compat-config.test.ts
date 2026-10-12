import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("explicit compatibility setting overrides the demo default", () => {
  for (const [setting, expected] of [
    [undefined, true],
    ["false", false],
    ["true", true],
  ] as const) {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_MODE: "demo" };
    delete env.ALLOW_COMPAT_AGENT_SESSIONS;
    if (setting !== undefined) env.ALLOW_COMPAT_AGENT_SESSIONS = setting;
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'import { config } from "./server/config.ts"; console.log(config.compatibility);',
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(result.trim(), String(expected));
  }
});
