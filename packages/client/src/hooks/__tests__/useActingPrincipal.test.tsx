import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActingPrincipal } from "@yep-anywhere/shared";
import { useActingPrincipal } from "../useActingPrincipal";
import { resetServerSettingsForTests } from "../useServerSettings";
import { resetClientQueryControllerForTests } from "../../lib/clientQueryController";
import { resetClientQueryBootstrapForTests } from "../../lib/clientQueryBootstrap";
import {
  asClientSummarySourceKey,
  getCurrentClientSummarySourceKey,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummarySourceKey";

const { sourceFetch } = vi.hoisted(() => ({ sourceFetch: vi.fn() }));
vi.mock("../../api/client", () => ({
  api: {
    getActingPrincipal: () =>
      sourceFetch(getCurrentClientSummarySourceKey(), "/users/me"),
  },
}));
vi.mock("../../lib/sourceRuntime", () => ({
  getSourceRuntimeRegistry: () => ({
    getOrCreateSourceRuntime: (sourceKey: string) => ({
      transport: { fetch: (path: string) => sourceFetch(sourceKey, path) },
    }),
  }),
}));

const alice: ActingPrincipal = {
  superuser: false,
  username: "alice",
  switched: false,
  locked: true,
  enabled: true,
  hasLimitedUsers: true,
  logoutRedirect: "stay",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetServerSettingsForTests();
  resetClientQueryControllerForTests();
  resetClientQueryBootstrapForTests();
  setCurrentClientSummarySourceKey(asClientSummarySourceKey("local"));
  sourceFetch.mockReset();
});
afterEach(() => {
  cleanup();
  resetServerSettingsForTests();
  resetClientQueryControllerForTests();
  resetClientQueryBootstrapForTests();
});

describe("acting principal identity boundary", () => {
  it("does not resolve a failed identity request as the superuser", async () => {
    sourceFetch.mockImplementation(async (_source, path) => {
      if (path === "/settings")
        return { settings: { limitedUsersEnabled: true } };
      throw new Error("offline");
    });
    const { result } = renderHook(useActingPrincipal);
    await waitFor(() =>
      expect(sourceFetch).toHaveBeenCalledWith("local", "/users/me"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolved).toBe(false);
  });

  it("does not carry a previous source identity into the next source", async () => {
    const next = deferred<ActingPrincipal>();
    sourceFetch.mockImplementation(async (source, path) => {
      if (path === "/settings")
        return { settings: { limitedUsersEnabled: true } };
      return source === "local" ? alice : next.promise;
    });
    const { result } = renderHook(useActingPrincipal);
    await waitFor(() =>
      expect(result.current.principal.username).toBe("alice"),
    );
    act(() =>
      setCurrentClientSummarySourceKey(asClientSummarySourceKey("host:second")),
    );
    expect(result.current.resolved).toBe(false);
    expect(result.current.principal.username).toBeNull();
    await waitFor(() =>
      expect(sourceFetch).toHaveBeenCalledWith("host:second", "/users/me"),
    );
    expect(result.current.resolved).toBe(false);
    await act(async () => next.resolve({ ...alice, username: "bob" }));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.principal.username).toBe("bob");
  });

  it("requires settings confirmation before treating the feature as off", async () => {
    const settings = deferred<unknown>();
    sourceFetch.mockReturnValue(settings.promise);
    const { result } = renderHook(useActingPrincipal);
    expect(result.current.resolved).toBe(false);
    await act(async () =>
      settings.resolve({ settings: { limitedUsersEnabled: false } }),
    );
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.principal.username).toBeNull();
    expect(
      sourceFetch.mock.calls.every(([, path]) => path === "/settings"),
    ).toBe(true);
  });

  it("ignores a previous source response that arrives after switching", async () => {
    const previous = deferred<ActingPrincipal>();
    sourceFetch.mockImplementation(async (source, path) => {
      if (path === "/settings")
        return { settings: { limitedUsersEnabled: true } };
      return source === "local"
        ? previous.promise
        : { ...alice, username: "bob" };
    });
    const { result } = renderHook(useActingPrincipal);
    await waitFor(() =>
      expect(sourceFetch).toHaveBeenCalledWith("local", "/users/me"),
    );
    act(() =>
      setCurrentClientSummarySourceKey(asClientSummarySourceKey("host:second")),
    );
    await waitFor(() => expect(result.current.principal.username).toBe("bob"));
    await act(async () => previous.resolve(alice));
    expect(result.current.resolved).toBe(true);
    expect(result.current.principal.username).toBe("bob");
  });

  it("does not let an older refresh replace the newest identity", async () => {
    const first = deferred<ActingPrincipal>();
    sourceFetch.mockImplementation(async (_source, path) => {
      if (path === "/settings")
        return { settings: { limitedUsersEnabled: true } };
      return first.promise;
    });
    const { result } = renderHook(useActingPrincipal);
    await waitFor(() =>
      expect(sourceFetch).toHaveBeenCalledWith("local", "/users/me"),
    );
    sourceFetch.mockResolvedValue(alice);
    await act(async () => result.current.refresh());
    expect(result.current.resolved).toBe(true);
    expect(result.current.principal.username).toBe("alice");
    await act(async () => first.resolve({ ...alice, username: "old-user" }));
    expect(result.current.principal.username).toBe("alice");
  });
});
