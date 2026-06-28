import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMore: vi.fn(),
  useGlobalSessionsFeed: vi.fn(),
}));

vi.mock("../useGlobalSessionsFeed", () => ({
  useGlobalSessionsFeed: mocks.useGlobalSessionsFeed,
}));

import {
  SIDEBAR_SESSION_FEED_LIMIT,
  useRetainSidebarSessionFeeds,
  useSidebarSessionFeeds,
} from "../useSidebarSessionFeeds";

beforeEach(() => {
  mocks.loadMore.mockReset();
  mocks.useGlobalSessionsFeed.mockReset();
  mocks.useGlobalSessionsFeed.mockReturnValue({
    query: { scope: "global-sessions" },
    loading: false,
    hasMore: false,
    loadMore: mocks.loadMore,
  });
});

describe("useRetainSidebarSessionFeeds", () => {
  it("retains global and starred sidebar coverage", () => {
    renderHook(() => useRetainSidebarSessionFeeds());

    expect(mocks.useGlobalSessionsFeed).toHaveBeenCalledTimes(2);
    expect(mocks.useGlobalSessionsFeed).toHaveBeenNthCalledWith(1, {
      limit: SIDEBAR_SESSION_FEED_LIMIT,
      includeStats: false,
    });
    expect(mocks.useGlobalSessionsFeed).toHaveBeenNthCalledWith(2, {
      starred: true,
      limit: SIDEBAR_SESSION_FEED_LIMIT,
      includeStats: false,
    });
  });
});

describe("useSidebarSessionFeeds", () => {
  it("keeps the visible Sidebar load-more controls wired to the same coverage", () => {
    const globalLoadMore = vi.fn();
    const starredLoadMore = vi.fn();
    mocks.useGlobalSessionsFeed
      .mockReturnValueOnce({
        query: { scope: "global-sessions" },
        loading: false,
        hasMore: true,
        loadMore: globalLoadMore,
      })
      .mockReturnValueOnce({
        query: { scope: "global-sessions", starred: true },
        loading: true,
        hasMore: false,
        loadMore: starredLoadMore,
      });

    const { result } = renderHook(() => useSidebarSessionFeeds());

    expect(mocks.useGlobalSessionsFeed).toHaveBeenCalledTimes(2);
    expect(result.current.globalQuery).toEqual({ scope: "global-sessions" });
    expect(result.current.starredQuery).toEqual({
      scope: "global-sessions",
      starred: true,
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.hasMoreGlobalSessions).toBe(true);
    expect(result.current.loadMoreGlobalSessions).toBe(globalLoadMore);
    expect(result.current.hasMoreStarredSessions).toBe(false);
    expect(result.current.loadMoreStarredSessions).toBe(starredLoadMore);
  });
});
