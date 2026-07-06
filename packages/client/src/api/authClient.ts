import { fetchJSON } from "./sourceApiFetch";

export interface AuthStatus {
  /** Whether auth is enabled in settings */
  enabled: boolean;
  /** Whether user has a valid session (or auth is disabled) */
  authenticated: boolean;
  /** Whether initial account setup is needed */
  setupRequired: boolean;
  /** Whether auth is bypassed by --auth-disable flag (for recovery) */
  disabledByEnv: boolean;
  /** Path to auth.json file (for recovery instructions) */
  authFilePath: string;
  /** Whether the server has a desktop auth token (Tauri app) */
  hasDesktopToken: boolean;
  /** Whether unauthenticated localhost access is allowed */
  localhostOpen: boolean;
}

export const authApi = {
  getAuthStatus: () => fetchJSON<AuthStatus>("/auth/status"),

  /** Enable auth with a password (fresh setup while auth is currently disabled) */
  enableAuth: (password: string) =>
    fetchJSON<{ success: boolean }>("/auth/enable", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  /** Disable auth (requires authenticated session) */
  disableAuth: () =>
    fetchJSON<{ success: boolean }>("/auth/disable", {
      method: "POST",
    }),

  /** @deprecated Use enableAuth instead */
  setupAccount: (password: string) =>
    fetchJSON<{ success: boolean }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  login: (password: string) =>
    fetchJSON<{ success: boolean }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  logout: () =>
    fetchJSON<{ success: boolean }>("/auth/logout", {
      method: "POST",
    }),

  changePassword: (newPassword: string) =>
    fetchJSON<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),

  /** Toggle unauthenticated localhost access (desktop token floor bypass) */
  setLocalhostAccess: (open: boolean) =>
    fetchJSON<{ success: boolean; localhostOpen: boolean }>(
      "/auth/localhost-access",
      {
        method: "POST",
        body: JSON.stringify({ open }),
      },
    ),
};
