export const AGENT_API_RECEIPTS_SCHEMA = `
CREATE TABLE agent_api_receipts (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT,
  source_session_id TEXT,
  state TEXT NOT NULL,
  receipt_json TEXT NOT NULL
);
CREATE TABLE agent_api_session_aliases (id TEXT PRIMARY KEY, target TEXT NOT NULL);
CREATE INDEX agent_api_receipts_session ON agent_api_receipts(session_id, kind);
CREATE INDEX agent_api_receipts_source ON agent_api_receipts(source_session_id, id);
`;
