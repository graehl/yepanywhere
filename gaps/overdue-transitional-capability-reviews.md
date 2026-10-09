# Two transitional capability reviews are overdue

`pnpm capabilities:audit` reports overdue review warnings for
`codex-paginated-rollout-lineage` and `session-fork-turn-intents`, each with
review date 2026-10-01. The audit reports zero contract errors. Do not move the
dates merely to silence the warnings: review the supported release corpus and
retain or retire the fallback based on that evidence.

These are separate provider/fork compatibility decisions; their owning topics
also have concurrent edits during native push work. They are outside native
push enrollment/delivery and cannot safely be resolved as formatter cleanup.

Found 2026-10-02 while validating native-push capability ownership.

Confirmed 2026-10-09 while validating hosted-vhost OAuth: zero contract
errors and the same two advisory warnings. No review dates were advanced.
Contributing-model: 6-Astra
