import { useGlobalSessionsFeed } from "./useGlobalSessionsFeed";
import type { SessionCollectionQueryDescriptor } from "../lib/clientSummaryCollections";

export const SIDEBAR_SESSION_FEED_LIMIT = 50;

export interface SidebarSessionFeeds {
  globalQuery: SessionCollectionQueryDescriptor;
  starredQuery: SessionCollectionQueryDescriptor;
  loading: boolean;
  hasMoreGlobalSessions: boolean;
  loadMoreGlobalSessions: () => Promise<void>;
  hasMoreStarredSessions: boolean;
  loadMoreStarredSessions: () => Promise<void>;
}

export function useRetainSidebarSessionFeeds(
  limit = SIDEBAR_SESSION_FEED_LIMIT,
): void {
  useGlobalSessionsFeed({
    limit,
    includeStats: false,
  });

  useGlobalSessionsFeed({
    starred: true,
    limit,
    includeStats: false,
  });
}

export function useSidebarSessionFeeds(
  limit = SIDEBAR_SESSION_FEED_LIMIT,
): SidebarSessionFeeds {
  const globalFeed = useGlobalSessionsFeed({
    limit,
    includeStats: false,
  });

  const starredFeed = useGlobalSessionsFeed({
    starred: true,
    limit,
    includeStats: false,
  });

  return {
    globalQuery: globalFeed.query,
    starredQuery: starredFeed.query,
    loading: globalFeed.loading || starredFeed.loading,
    hasMoreGlobalSessions: globalFeed.hasMore,
    loadMoreGlobalSessions: globalFeed.loadMore,
    hasMoreStarredSessions: starredFeed.hasMore,
    loadMoreStarredSessions: starredFeed.loadMore,
  };
}
