/**
 * Make the server test suite reproducible regardless of the developer's shell.
 *
 * `loadConfig()` reads `process.env`, and `run-with-safe-home.js` passes the
 * full environment through to vitest. So a dev who exports a runtime knob for
 * their live server (e.g. `YEP_DEFERRED_JOIN_WINDOW_S=30` in local.sh) silently
 * changes behavior under test — a test can pass on CI (clean env) and fail
 * locally, or vice versa. This is exactly what made the deferred one-per-boundary
 * test non-reproducible.
 *
 * This setup runs before each test file and removes every env var
 * `packages/server/src/config.ts` consults, so config resolves to its built-in
 * defaults. Tests that exercise a specific var still set it explicitly with
 * `vi.stubEnv(...)`, which takes effect after this and is auto-restored.
 *
 * NOT cleared: test-harness gates the test scripts set deliberately
 * (`REAL_SDK_TESTS`, `FOREGROUND`) and `HOME` (safe-home owns it). Keep
 * CONFIG_ENV_VARS in sync with the `process.env.*` reads in config.ts.
 */
import { CONFIG_ENV_VARS } from "./config-env-vars.js";

for (const name of CONFIG_ENV_VARS) {
  delete process.env[name];
}
