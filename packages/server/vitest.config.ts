import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["source"],
  },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    // Strip developer-shell config env (e.g. YEP_DEFERRED_JOIN_WINDOW_S) before
    // each file so the suite reproduces identically everywhere. See the setup file.
    setupFiles: ["./test/setup/hermetic-env.ts"],
    passWithNoTests: true,
    maxWorkers: 4,
    minWorkers: 1,
    poolOptions: {
      // node:sqlite (opencode-db-reader, a deliberate zero-native-dependency
      // choice with guarded fallbacks) makes Node print an ExperimentalWarning
      // per worker. Silence it in test output only, so real warnings stay
      // visible; production server logs still show Node's notice. The flag
      // needs Node >= 20.13, comfortably inside the >=20 engines floor's
      // maintained range.
      threads: {
        execArgv: ["--disable-warning=ExperimentalWarning"],
      },
      forks: {
        execArgv: ["--disable-warning=ExperimentalWarning"],
      },
    },
  },
});
