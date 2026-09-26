# Optional project-local instruction copies at template instantiation

User-requested proposal, 2026-09-26. Capture only; implementation is not
authorized by this sketch.

The intended default is one shared definition of referenced instructions and
topics. Template sources, including their referenced topics from the agents
repository, are updated manually on request. Such an update is intended to
affect existing projects that retain live references; that behavior is not a
defect to eliminate.

Offer an opt-in **Vendor referenced instructions** choice when YA instantiates
a project template. Resolve the selected instructions, topics, and their
required referenced resources at creation time, copy them into the new
project, and replace their links with links to those in-project copies.
Preserve transitive references and section anchors, and share one local copy
when several instructions refer to the same topic. Merely pinning a template
source revision or copying a top-level instruction while leaving its topic
links live does not provide this option.

The resulting project keeps that instruction snapshot when the source library
is later updated. Leave both existing projects and the shared-reference default
unchanged. Decide local destination conventions, provenance, and any explicit
refresh workflow during implementation; do not silently refresh vendored
copies or introduce automatic source updates.

Acceptance example: create one project with default references and another
with vendoring enabled, then manually update a shared topic. The first reads
the updated definition; the second still reads its original local copy through
both direct and nested instruction links. Its vendored instruction links also
resolve when the source library is unavailable.

This is an instantiation option in YA, not a change to how the authoring
repository maintains its canonical topics. The current
[project-template contract](../../topics/project-templates.md),
[stand-up gap](../project-template-standup.md), and
[selective-retrieval gap](../project-template-selective-retrieval.md) contain
older unconditional portability/vendoring language. Reconcile those passages
with the shared-reference default and this opt-in alternative when implementing
creation. Source acquisition and optional automatic-update checks remain
separate concerns.

Found 2026-09-26 during the agents repository's harsh review and the user's
clarification of template-update semantics.
Contributing-model: 6-Astra
