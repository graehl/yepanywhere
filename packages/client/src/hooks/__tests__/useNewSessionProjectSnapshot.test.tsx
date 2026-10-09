import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EMPTY_LIMITED_USER_GRANTS,
  toUrlProjectId,
  type ActingPrincipal,
} from "@yep-anywhere/shared";
import type { Project } from "../../types";
import { useNewSessionProjectSnapshot } from "../useNewSessionProjectSnapshot";
import {
  newSessionProjectSnapshotKey,
  readNewSessionProjectSnapshot,
  writeNewSessionProjectSnapshot,
} from "../../lib/newSessionProjectSnapshot";
import {
  asClientSummarySourceKey,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummarySourceKey";

const identity = vi.hoisted(() => ({
  resolved: true,
  principal: { username: null } as ActingPrincipal,
}));
vi.mock("../useActingPrincipal", () => ({
  useActingPrincipal: () => identity,
}));

const alpha: Project = {
  id: toUrlProjectId("/work/alpha"),
  path: "/work/alpha",
  name: "Alpha",
  sessionCount: 100,
  activeOwnedCount: 2,
  activeExternalCount: 3,
  lastActivity: "2026-10-09",
  projectQueueBlockingCount: 4,
};
const beta: Project = {
  ...alpha,
  id: toUrlProjectId("/other/beta"),
  path: "/other/beta",
  name: "Beta",
};
const pending = {
  projects: [] as Project[],
  complete: false,
  recentProjectIds: [] as string[],
  visitsLoading: true,
};

beforeEach(() => {
  localStorage.clear();
  identity.resolved = true;
  identity.principal = { username: null } as ActingPrincipal;
  setCurrentClientSummarySourceKey(asClientSummarySourceKey("local"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows a saved choice without making it a confirmed project", () => {
  writeNewSessionProjectSnapshot(
    "local",
    identity.principal,
    [alpha],
    [alpha.id],
  );
  const { result, rerender } = renderHook(useNewSessionProjectSnapshot, {
    initialProps: pending,
  });
  expect(result.current.projects[0]?.name).toBe("Alpha");
  expect(result.current.unconfirmedProjectIds).toEqual([alpha.id]);
  expect(result.current.recentProjectIds).toEqual([alpha.id]);
  rerender({
    projects: [{ ...alpha, name: "Renamed" }],
    complete: true,
    recentProjectIds: [],
    visitsLoading: false,
  });
  expect(result.current.projects[0]?.name).toBe("Renamed");
  expect(result.current.unconfirmedProjectIds).toEqual([]);
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)?.projects[0]
      ?.name,
  ).toBe("Renamed");
  expect(result.current.recentProjectIds).toEqual([]);
});

it("requires confirmed identity and separates sources and accounts", () => {
  writeNewSessionProjectSnapshot("local", identity.principal, [alpha], []);
  identity.resolved = false;
  const { result, rerender } = renderHook(useNewSessionProjectSnapshot, {
    initialProps: pending,
  });
  expect(result.current.projects).toEqual([]);
  identity.resolved = true;
  rerender(pending);
  expect(result.current.projects).toHaveLength(1);
  act(() =>
    setCurrentClientSummarySourceKey(asClientSummarySourceKey("host:other")),
  );
  expect(result.current.projects).toEqual([]);
  act(() =>
    setCurrentClientSummarySourceKey(asClientSummarySourceKey("local")),
  );
  identity.principal = {
    ...identity.principal,
    username: "alice",
    grants: { ...EMPTY_LIMITED_USER_GRANTS, viewProjects: [alpha.id] },
  };
  rerender(pending);
  expect(result.current.projects).toEqual([]);
});

it("filters revoked grants, including directory grants", () => {
  identity.principal = {
    ...identity.principal,
    username: "alice",
    grants: {
      ...EMPTY_LIMITED_USER_GRANTS,
      viewProjects: [beta.id],
      pathGrants: [{ path: "/work", level: "view" }],
    },
  };
  writeNewSessionProjectSnapshot(
    "local",
    identity.principal,
    [alpha, beta],
    [beta.id, alpha.id],
  );
  const { result, rerender } = renderHook(useNewSessionProjectSnapshot, {
    initialProps: pending,
  });
  expect(result.current.projects).toHaveLength(2);
  identity.principal = {
    ...identity.principal,
    grants: {
      ...EMPTY_LIMITED_USER_GRANTS,
      pathGrants: [{ path: "/work", level: "view" }],
    },
  };
  rerender(pending);
  expect(result.current.projects.map((project) => project.id)).toEqual([
    alpha.id,
  ]);
  expect(result.current.recentProjectIds).toEqual([alpha.id]);
});

it("preserves undiscovered rows after partial results, but accepts complete deletion", () => {
  writeNewSessionProjectSnapshot(
    "local",
    identity.principal,
    [alpha, beta],
    [beta.id],
  );
  const { result, rerender } = renderHook(useNewSessionProjectSnapshot, {
    initialProps: pending,
  });
  rerender({ ...pending, projects: [alpha] });
  expect(result.current.projects.map((project) => project.id)).toEqual([
    alpha.id,
    beta.id,
  ]);
  expect(result.current.unconfirmedProjectIds).toEqual([beta.id]);
  rerender({ ...pending, complete: true, visitsLoading: false });
  expect(result.current.projects).toEqual([]);
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)?.projects,
  ).toEqual([]);
});

it("observes a sibling tab's accepted snapshot without fetching again", () => {
  const { result } = renderHook(useNewSessionProjectSnapshot, {
    initialProps: pending,
  });
  expect(result.current.projects).toEqual([]);
  writeNewSessionProjectSnapshot(
    "local",
    identity.principal,
    [beta],
    [beta.id],
  );
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: newSessionProjectSnapshotKey("local", null),
      }),
    ),
  );
  expect(result.current.projects[0]?.id).toBe(beta.id);
});

it("keeps only display fields and bounds age, row count and bytes", () => {
  vi.useFakeTimers();
  writeNewSessionProjectSnapshot("local", identity.principal, [alpha], []);
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)?.projects[0],
  ).toEqual({
    id: alpha.id,
    path: alpha.path,
    name: alpha.name,
    sessionCount: 0,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  });
  vi.advanceTimersByTime(25 * 60 * 60_000);
  expect(readNewSessionProjectSnapshot("local", identity.principal)).toBeNull();
  const key = newSessionProjectSnapshotKey("local", null);
  expect(localStorage.getItem(key)).toBeNull();
  const many = Array.from({ length: 300 }, (_, n) => ({
    ...alpha,
    id: `p${n}`,
  }));
  writeNewSessionProjectSnapshot("local", identity.principal, many, ["p299"]);
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)?.projects,
  ).toHaveLength(256);
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)?.projects[0]?.id,
  ).toBe("p299");
  writeNewSessionProjectSnapshot(
    "local",
    identity.principal,
    many,
    ["p299"],
    "p298",
  );
  expect(
    readNewSessionProjectSnapshot("local", identity.principal)
      ?.projects.slice(0, 2)
      .map((project) => project.id),
  ).toEqual(["p298", "p299"]);
  localStorage.setItem(key, "x".repeat(256 * 1024));
  expect(readNewSessionProjectSnapshot("local", identity.principal)).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
});

it.each(["null", "not-json", '{"version":2}', '{"version":1,"savedAt":-1}'])(
  "ignores invalid storage: %s",
  (raw) => {
    localStorage.setItem(newSessionProjectSnapshotKey("local", null), raw);
    expect(
      readNewSessionProjectSnapshot("local", identity.principal),
    ).toBeNull();
  },
);
