/**
 * Provider-neutral, in-memory display semantics for one tool execution.
 *
 * These actions are derived from the provider's durable call description. They
 * are presentation metadata only: they do not create separate executions or
 * own tool results, and YA does not persist them as another transcript source.
 */

export interface ToolDisplayReadAction {
  kind: "read";
  path: string;
  absolutePath?: string;
  name: string;
  startLine?: number;
  endLine?: number;
}

export interface ToolDisplaySearchAction {
  kind: "search";
  query: string;
  path?: string;
}

export interface ToolDisplayListAction {
  kind: "list";
  path?: string;
}

export type ToolDisplayAction =
  | ToolDisplayReadAction
  | ToolDisplaySearchAction
  | ToolDisplayListAction;
