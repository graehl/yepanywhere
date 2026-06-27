import { useGlobalSessionsFeed } from "./useGlobalSessionsFeed";

export interface SidebarSessionFeeds {
  loading: boolean;
  hasMoreGlobalSessions: boolean;
  loadMoreGlobalSessions: () => Promise<void>;
  hasMoreStarredSessions: boolean;
  loadMoreStarredSessions: () => Promise<void>;
}

export function useSidebarSessionFeeds(limit: number): SidebarSessionFeeds {
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
    loading: globalFeed.loading || starredFeed.loading,
    hasMoreGlobalSessions: globalFeed.hasMore,
    loadMoreGlobalSessions: globalFeed.loadMore,
    hasMoreStarredSessions: starredFeed.hasMore,
    loadMoreStarredSessions: starredFeed.loadMore,
  };
}
