# Conservative issue discovery and session browsing

Authorized 2026-09-11. Builds on the completed implementation recorded in
`tasks/issue-session-associations-progress.md` and
[issue/session associations](../../topics/issue-session-associations.md).
No matching open UI/discovery gap exists; the adjacent discovery-storage gap
does not change this feature's cross-session ownership.

### 1 — learn durable Jira projects from explicit links

- Add migration 7 for prefix/site mappings and bounded reconciliation progress.
- Learn from supported absolute Jira issue URLs in user/assistant text. Keep
  tool commands, tool output, reasoning, and setup excluded.
- Default to explicit references and known prefixes. Expose aggressive unknown
  key matching as an opt-in; retain editable prefix exclusions.
- Reconcile retained candidates after learning and rule changes, preserving
  explicit decisions, titles, and evidence. Backfill from stored URLs after
  startup in bounded batches, without reading provider transcripts in migration.
- Keep conflicting sites distinct; exact project-local URL evidence may resolve
  ambiguity, but a global prefix must never silently choose between sites.

### 2 — present one associated session at a time

- Paginate distinct sessions, sorted by latest catalog activity with explicit
  sorting copy and deterministic ties. One initial excerpt per session; expand
  additional mentions independently without duplicating rows across pages.
- Reuse SessionListItem and its shared hover preview. Put association correction
  actions in an overflow menu and issue display-title editing in the left list.
- Quiet coverage/filter controls and replace unresolved tracker jargon with
  actionable issue-link copy. Show learned projects in discovery settings.

### 3 — verify migration, discovery, and browsing

- Cover migration prefixes/rollback/preservation, restart persistence, prefix
  collisions, retroactive rule changes, and default/opt-in detection.
- Cover distinct-session pagination, activity sorting, expansion, menus, title
  editing, source switching, and desktop/phone layouts.
- Run lint, format, typecheck, unit and E2E suites, capability/CSS/console checks;
  capture and inspect desktop and phone through the artifact facility.
- Update the owning topic and roadmap status with the final behavior.

Compatibility: the approved optional corpus is v0.8.0 and v0.8.1. Neither
provides this experimental feature. Its unpublished v1 contract explicitly
permits evolution before release; keep capability 68 and its absent-capability
no-request fallback. Add grouped session reads, session-filtered evidence,
learned-project settings metadata, and the aggressive-matching setting within
that contract. No stable capability meaning or compatibility floor changes.

## Validation and handoff

Implemented; commit and push authorized. The owning topic records the
final discovery, migration, grouping, sorting and correction contracts.

- Full `pnpm test`: 11,696 passed (55 skipped server tests).
- Full `pnpm test:e2e`: 222 passed, 7 skipped, on a fixed source snapshot.
- Typecheck, format verification, CSS containment/module checks, console budget,
  and capability audit pass. New files also pass explicit-path Biome lint.
- The existing unused suppression in `ParagraphQuoteRail.test.tsx` was removed
  as an isolated cleanup before committing. Repository lint reports no warnings;
  existing informational suggestions for a redundant fragment in
  `SessionListItem.tsx` and template literal style in
  `native-tool-display-lifecycle.ts` remain unchanged.
- Packaged discovery SQLite contract passes on Node 24.20.0/macOS. Bun was not
  installed on this host; Linux/Windows/Bun execution remains CI coverage.
- CSS ownership extraction was deferred for SessionListItem's 15 coupled legacy
  rules and the settings shared toggle; this pass adds no legacy global styles.
- Desktop/phone session and hover captures were inspected and presented through
  the repository artifact facility at
  `.artifacts/ui-testing/2026-09-11-issues-verified/session-review/`.
  The final discovery-settings capture pass (2 browser tests passed) includes
  learned projects at `.artifacts/ui-testing/2026-09-11-issues-settings-final/`.
  Both viewport images were individually inspected and presented.

An earlier full E2E attempt was invalidated by source edits during its run:
its stale-runtime banner interfered with unrelated viewer controls. The fresh
full run above passed those tests without changes to their implementation.
