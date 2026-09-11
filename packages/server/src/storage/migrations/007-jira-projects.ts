/** Durable URL-derived Jira namespaces; startup only schedules bounded backfill. */
export const JIRA_PROJECT_SCHEMA = `
CREATE TABLE jira_project_sites (
 prefix TEXT NOT NULL, site TEXT NOT NULL, project_id TEXT NOT NULL,
 learned_at INTEGER NOT NULL,
 PRIMARY KEY(prefix,site,project_id)
) WITHOUT ROWID;
CREATE TABLE issue_registry_work (
 id INTEGER PRIMARY KEY CHECK(id=1), phase INTEGER NOT NULL DEFAULT 0,
 after_id INTEGER NOT NULL DEFAULT 0
);
INSERT INTO issue_registry_work(id) VALUES (1);
`;
