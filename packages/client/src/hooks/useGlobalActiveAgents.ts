import { useActiveAgentCount } from "../lib/clientSummaryStore";

/**
 * Compatibility hook for active-agent count consumers.
 *
 * The InboxProvider owns fetching /api/inbox snapshots; this hook reads the
 * active tier count from the shared client summary store.
 */
export function useGlobalActiveAgents() {
  return useActiveAgentCount();
}
