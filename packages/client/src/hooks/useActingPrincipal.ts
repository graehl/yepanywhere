import { useCallback, useEffect, useRef, useState } from "react";
import type { ActingPrincipal } from "@yep-anywhere/shared";
import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";
import { useServerSettings } from "./useServerSettings";

/**
 * Who this client is acting as: the superuser, or one limited user.
 *
 * Contract: topics/limited-users.md § Delivery v1. The server is the
 * authority; this hook only decides what to show. Settings must confirm that
 * the feature is off before the superuser placeholder is a resolved identity.
 */
const SUPERUSER_PRINCIPAL: ActingPrincipal = {
  superuser: true,
  username: null,
  switched: false,
  locked: false,
  enabled: false,
  hasLimitedUsers: false,
  logoutRedirect: "stay",
};

export interface ActingPrincipalState {
  principal: ActingPrincipal;
  loading: boolean;
  /**
   * Whether `principal` is the server's answer rather than the superuser
   * placeholder. Before this is true the placeholder is indistinguishable
   * from a real superuser, so a caller that would send a superuser-only
   * request must wait: a switched superuser or a limited user would
   * otherwise fire one refused request on every load.
   */
  resolved: boolean;
  refresh: () => Promise<void>;
}

/**
 * Ask who this client is acting as. The request is skipped entirely while the
 * feature is off, which is the default: a server with one principal should
 * not answer an identity request on every page load.
 */
export function useActingPrincipal(): ActingPrincipalState {
  const sourceKey = useClientSummarySourceKey();
  const { settings, isLoading: settingsLoading } = useServerSettings();
  const enabled = settings?.limitedUsersEnabled === true;
  const generation = useRef(0);
  const [state, setState] = useState<{
    sourceKey: string;
    enabled: boolean;
    principal: ActingPrincipal | null;
    loading: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!enabled) {
      setState(null);
      return;
    }
    const transport =
      getSourceRuntimeRegistry().getOrCreateSourceRuntime(sourceKey).transport;
    setState({ sourceKey, enabled, principal: null, loading: true });
    try {
      const principal = await transport.fetch<ActingPrincipal>("/users/me");
      if (generation.current === requestGeneration)
        setState({ sourceKey, enabled, principal, loading: false });
    } catch {
      if (generation.current === requestGeneration)
        setState({ sourceKey, enabled, principal: null, loading: false });
    }
  }, [enabled, sourceKey]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const current =
    state?.sourceKey === sourceKey && state.enabled === enabled ? state : null;
  const principal = current?.principal ?? SUPERUSER_PRINCIPAL;
  const loading = enabled && (current?.loading ?? true);
  const resolved =
    settings !== null &&
    !settingsLoading &&
    (!enabled || current?.principal != null);

  return { principal, loading, resolved, refresh };
}

/** Whether the acting principal is a limited user. */
export function isLimitedPrincipal(principal: ActingPrincipal): boolean {
  return principal.username !== null;
}

/**
 * Whether this client may be shown host-administration notices — a server
 * restart, a Codex or YA server update — that only the superuser can act on.
 * False until the principal is known, so a limited user never sees one flash.
 */
export function useCanAdministerHost(): boolean {
  const { principal, resolved } = useActingPrincipal();
  return resolved && !isLimitedPrincipal(principal);
}

/**
 * Whether this client may use public session shares and app links, the
 * bearer grants the server refuses to a limited user. False until the
 * principal is known, so a limited user sends none of those refused requests
 * and is shown no refusal in their place.
 */
export function useCanUseBearerGrants(): boolean {
  const { principal, resolved } = useActingPrincipal();
  return resolved && !isLimitedPrincipal(principal);
}
