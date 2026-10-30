/** Only provider failures establish quota exhaustion; model prose is not one. */
export function providerLimitReached(
  events: Record<string, unknown>[],
  stderr: string,
  code: number | null,
) {
  const failures = events.filter(
    (event) => event.type === "error" || event.type === "turn.failed",
  );
  return /(?:rate.limit|usage.limit|quota.exhaust|\b429\b)/i.test(
    `${JSON.stringify(failures)}\n${code === 0 ? "" : stderr}`,
  );
}

/** Disposable access-only auth: a trial must never rotate the operator's refresh token. */
export function trialAuth(saved: string, budgetMs: number, now = Date.now()) {
  const parsed = JSON.parse(saved) as {
    auth_mode?: string;
    tokens?: { access_token?: string; refresh_token?: string };
    last_refresh?: string;
  };
  if (parsed.auth_mode !== "chatgpt" || !parsed.tokens?.access_token)
    throw new Error(
      "A saved ChatGPT Codex sign-in is required; API-key billing is not used",
    );
  let expires = 0;
  try {
    expires =
      Number(
        JSON.parse(
          Buffer.from(
            parsed.tokens.access_token.split(".")[1]!,
            "base64url",
          ).toString(),
        ).exp,
      ) * 1000;
  } catch {
    /* rejected below */
  }
  const lastRefresh = Date.parse(parsed.last_refresh ?? "");
  // Current Codex refreshes near expiry or after eight days. Require margin;
  // omit the actual refresh authority even if the CLI attempts recovery.
  if (
    !Number.isFinite(expires) ||
    expires < now + budgetMs + 6 * 60_000 ||
    !Number.isFinite(lastRefresh) ||
    lastRefresh < now - 7 * 24 * 60 * 60_000
  )
    throw new Error(
      "Saved Codex access needs refreshing before this eval budget; refresh through the normal Codex sign-in first",
    );
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { ...parsed.tokens, refresh_token: "" },
    last_refresh: parsed.last_refresh,
  });
}
