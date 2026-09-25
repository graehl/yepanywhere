# Two-way, source-aware review rounds on session artifacts

Status: actionable proposal, not implemented. Requested 2026-09-21.

Let a user point at a session right-pane artifact, quote-reply or open a
comment editor at that location, collect several comments, and explicitly
submit the set to the originating session. Cover text and non-text targets,
especially SVG. The session can also send a revision-round proposal already
annotated with questions, comments, suggestions, advance justifications and
highlights for the user. The user answers those prompts and adds their own
spatial comments within the same round. A separate browser tab may return to
that session if cheap; right-pane-only is an acceptable first release. This is new capability, so it
lives under sketches rather than asserting an existing contract is broken.

## Existing owners and the missing seam

- [Selection comment UI](../../topics/selection-comment-ui.md#session-file-comment-mode)
  already owns source-aware quote replies and inline session-file comments.
  `packages/client/src/components/FileViewer.tsx` explicitly excludes HTML
  previews from Comment mode. Its source and Markdown editors are reusable.
- `lib/sessionFileComments.ts` and `hooks/useSessionFileComments.ts` under
  `packages/client/src/` own draft keys, batch formatting, persistence and
  removal of successfully submitted snapshots. Existing text mode sends on
  Enter and flushes on blur/close/minimize; that is **not** the requested
  deliberate review-set submission behavior. Preserve that existing mode.
- `components/ArtifactPreview.tsx`, `ArtifactLinkViewer.tsx`, and
  `SessionRightPane.tsx` display separate-origin or scriptless iframes, without
  a rendered-target annotation adapter. Parent selection listeners cannot
  reach inside those frames. A keyboard shortcut alone cannot fix this.
- [Session right pane](../../topics/session-right-pane.md) owns placement and
  lifecycle. [Active content security](../../topics/active-content-security.md#preview-and-authority)
  owns artifact isolation; the current contract supplies no host bridge.
- [Plannotator integration](plannotator-integration.md) owns CLI app reach and
  vhost delivery. This proposal owns artifact comments, not a replacement proxy.
  [HTML viewer](../html-document-viewer.md) owns broader document interaction;
  [direct text editing](direct-text-edit-in-viewer.md) is a separate write feature.

YA inspection: 2026-09-21 working tree; relevant symbols above were checked
against implementation. No runtime or browser acceptance trial was performed.

## Plannotator suitability and alternative implementations

Upstream inspected at
[`8f2a8a81a384f1cd39c5f083d3c6fcd35a956422`](https://github.com/backnotprop/plannotator/tree/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422).
This is source evidence, not proof that YA's installed binary has these APIs.

| Evidence | Consequence for YA |
| --- | --- |
| [`HtmlViewer`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/components/html-viewer/HtmlViewer.tsx) accepts annotations, add/select callbacks, drag or pinpoint input, and an annotation-mode toggle. | Trial it as the sole rendered-artifact annotation surface; YA supplies session ownership and submission. |
| [`html-anchor.ts`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/core/html-anchor.ts) records selector/tag/text/point and bounded element context. | Useful location awareness exists even without selectable text. The HTML anchor does not contain a source filename/line range. |
| [`parser.ts`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/utils/parser.ts) exports element context with feedback. | Preserve that context through YA submission; do not reduce comments to prose alone. |
| [`@plannotator/ui` host documentation](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/README.md#raw-html-annotation-viewer-htmlviewer) describes reusable components and host seams. | A library adapter is a supported candidate, distinct from launching a CLI process per artifact. |

**Recommendation:** try Plannotator first, using a live-ish App produced by a
project-template session as the deciding integration case. Keep the artifact
target/round interchange independent of the annotation UI. Prefer small,
general-purpose Plannotator extensions that can be contributed upstream when
needed; exclusive use is conditional on the complete two-way workflow fitting
smoothly. Direct artifact DOM, a pinned fork, and selective design borrowing
remain alternatives. Keep YA's existing text-file workflow.

**User-directed trial preference, 2026-09-21:** Plannotator is welcome if a
project-template session's live-ish App artifacts flow into it smoothly, and
contributing extensions is a possible outcome. This records design direction,
not an instruction to contact upstream or publish a contribution now.
Contributing-model: 6-Astra

### Deciding trial: project-template App to review to revision

Use the [project-template App](../../topics/project-templates.md#first-template-app-canvas)
workflow, not only a standalone static HTML sample. Here **live-ish** means
the App remains interactive and the producing session can publish revisions;
it does not require a long-running backend. Exercise the actual selected
delivery path: an artifact grant for a generated bundle, or a proxied live App
when that template needs one. A localhost-only demo does not prove hosted use.

The user opens the session's App, enters review without manually exporting,
copying URLs, installing Plannotator, or starting a review CLI, interacts with
the App, then answers its prelabelled questions and sends comments back to the
same session. Preserve the viewed route/state where feasible; if entering
review requires a reload or snapshot, make that transition explicit and test
its effect. Keep relative assets, modules, SVG and source metadata working.
Do not substitute a flattened Markdown rendering or screenshot for the App.

When the producer publishes another revision, announce its availability and
let the reviewer advance deliberately. Pin open drafts to their viewed
revision; do not reload underneath an active editor or mix locations from
different builds. Test one full proposal → responses → revised App round over
direct and hosted-relay access, including a disconnect and restored drafts.

Likely extension candidates are lossless authored target ids/source metadata,
external HTML prelabels with reply identities, agent/user styling hooks, and
host-managed completion and revision changes. Verify each missing seam before
proposing it. Keep upstream-facing APIs host-neutral; YA retains session
routing and authorization. If local patches are needed for the trial, keep
them pinned and documented so a later upstream release can replace them.
Choose a bypass only after recording the concrete integration cost or blocker.

### Verified support and limits for session-authored prelabelling

At the pinned revision above:

- The [external annotations API](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/apps/marketing/src/content/docs/integrations/external-annotations-api.md)
  accepts single or batched external annotations, including from AI tools,
  alongside user annotations. It documents source badges and inclusion of
  external annotations in submitted feedback. Thus incoming agent commentary
  is supported; Plannotator is not limited to user-authored comments.
- [Annotation types](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/types.ts)
  carry `author`, `source`, `inReplyTo`, HTML anchors and element context.
  [AnnotationPanel](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/components/AnnotationPanel.tsx)
  groups replies and displays authors. These are useful building blocks for
  a question and its answer, not proof of a complete revision-round protocol.
- Distinct agent-versus-user border/background/highlight styling is **not
  established** by this inspection. The inspected panel styles selection and
  annotation type; author text alone does not meet the requested distinction.
  Verify both cards and spatial marks in the adapter trial.
- The pinned [plan-input transformer](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/core/external-annotation.ts)
  does not copy HTML anchors or `inReplyTo` into its constructed POST records,
  although the UI types and patch validators expose richer fields. Do not
  assume an external-API POST round-trips the library's annotation shape.
  Direct library props are a separate path; recheck any newer pin explicitly.

Conclusion: **partial support, worth testing**, not a reason to constrain the
artifact protocol. No verified end-to-end support yet for the requested
authorship styling, question completion semantics and YA session delivery.
If these require awkward adaptation, bypass Plannotator for authored artifacts
or use a narrowly maintained fork. Reuse designs or selected components where
helpful; copied source follows the pinned-vendoring and license requirements.

**User-directed dependency decision, 2026-09-21:** a Plannotator dependency is
acceptable for this explicitly invoked feature. Do not reopen that decision or build a
replacement solely to avoid the dependency. The trial establishes technical
fit: package availability, license, dependencies, lazy-load cost, asset
resolution and browser behavior. Keep loading and activation scoped to the
opt-in surface. This clarification approves the dependency direction; the
implementation sequence below remains planned work.
Contributing-model: 6-Astra

**User-directed packaging preference, 2026-09-21:** provision a pinned or
vendored Plannotator automatically; a separately maintained global install
should not be a prerequisite. Recommended order:

- For the library adapter, pin exact package versions and lockfile integrity,
  package its matching bridge assets with YA, and lazy-load the feature. Normal
  YA installation/build supplies it; no browser-time fetch from a moving CDN.
- If a separate runtime is necessary, first invocation provisions a
  versioned YA app-data installation from a fixed release artifact. Record
  platform/architecture and a reviewed checksum in YA's manifest, verify before
  activation, and atomically place the complete installation. Reuse a valid
  cached copy offline; show download progress and a retryable failure when no
  usable copy exists. Do not invoke a latest-version installer, overwrite a
  user's global binary, or run an unverified/partially downloaded executable.
- If packages or release artifacts cannot provide the needed integration,
  vendor the required source at an exact upstream commit with licenses,
  file hashes and every local divergence recorded in `VENDORED.md`.

Update pins deliberately with YA changes and test host/bridge compatibility;
do not auto-upgrade upstream independently. The first trial must choose and
verify one of these delivery paths, including packaged YA and hosted-client
use, rather than relying on this machine's existing Plannotator install.
Contributing-model: 6-Astra

There are material integration questions. Plannotator's `src` live-app mode
expects its proxy to inject the bridge and declares an unsandboxed frame; it
is not a drop-in wrapper around YA's granted artifact URL. Its raw-HTML mode
has different asset/CSP requirements. `annotateModeActive=false` also leaves
text-selection commenting live, so it alone does not implement YA's opt-in
behavior. The trial must preserve the ordinary viewer until explicitly armed.

## Invocation is the opt-in; YA owns setup and delivery

**User-directed UI clarification, 2026-09-21:** an annotation accelerator is
available by default on arbitrary YA document/artifact views. Pressing it is
the opt-in: no separate enable setting and no harness Plannotator skill install
is required. YA retrieves the pinned Plannotator or YA-shipped alternative
code on first use, opens review for the current view, and orchestrates any
needed prompt/context injection, callback and response delivery. This replaces
the earlier default-off feature-setting proposal. It does not turn annotation
capture on merely because a document opens.
Contributing-model: 6-Astra

Ship only the small activation path eagerly. First invocation lazy-loads
bundled annotation code or provisions the pinned runtime through the managed
path above, with immediate loading/progress, cancellation and actionable error
feedback. Repeated activation shares one acquisition; later use reuses the
verified installation. No background download, agent launch, prompt injection
or annotation capture occurs just from viewing content. An equivalent visible
viewer action supplies discoverability, touch access and keyboard fallback.

YA owns the feature lifecycle across providers. Host callbacks bind the viewed
artifact/round to the canonical session, route context through existing send
and queue mechanisms, and prevent duplicate CLI-plus-YA delivery. Installing
provider skills/hooks or modifying global harness configuration is not part
of activation. Optional producer prelabelling skills remain an enrichment;
they are never required to annotate an existing arbitrary document. Invoking
review prepares the context; sending comments or requesting agent work remains
an explicit action within it, not an automatic provider turn on every open.

Arbitrary views get the best available mode: source-aware selection, rendered
element selection, or document/visual context with an honest limitation.
Exact source mapping and semantic replay remain producer capabilities. A
standalone view without a bound session can collect drafts, then asks for a
destination before delivery; a public view does not gain send authority.

### Shortcut audit — 2026-09-21

Static YA source audit found no annotation binding for Ctrl+Alt+A or
Ctrl+Shift+A. `ViewerSelectAllButton.tsx` accepts Ctrl/Cmd+A but explicitly
rejects Alt and Shift; `useSelectionActionPresentation.tsx` and
`earlyTypingHandoff.ts` reject Ctrl/Meta/Alt for typing capture. Relevant
viewer, pane, modal and session handlers do not supply this activation.
The user's report that Ctrl+Alt+A produced no visible action is consistent
with this absence, not evidence that a hidden integration already exists.

Plannotator's pinned
[HTML shortcut registry](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/shortcuts/plan-review/htmlAnnotate.shortcuts.ts)
uses `Mod+Shift+A` for annotate mode: Ctrl+Shift+A on Windows/Linux,
Cmd+Shift+A on macOS. It is a toggle inside an already loaded review, not an
installer or a global YA accelerator. Ctrl+Alt+A is not that binding.

Do not adopt Ctrl+Shift+A as YA's default without resolving browser conflicts:
[Chromium's accelerator table](https://chromium.googlesource.com/chromium/src/+/f57d8c09853a5ef39afa6cedf1d5ce683a142303/chrome/browser/ui/views/accelerator_table.cc)
assigns it to tab search on non-Mac platforms, and
[Firefox documents it for Add-ons](https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly).
Ctrl+Alt+A is a candidate, not yet the chosen cross-platform default; account
for AltGr/international text entry and OS/user shortcuts. Preserve IME and
editable controls, provide a remapping/disable route, and test real browser
delivery on Windows and Linux before naming the default. Documentation and
source inspection here are not a live keyboard-routing test.

Keyboard events inside a cross-origin iframe do not bubble to YA's document.
For YA-controlled artifacts, a minimal activation bridge may forward the
gesture before the annotation package is loaded; it must remain inert except
for invocation. Uncooperative frames need the YA viewer-header action or
focus returned to host chrome. Do not promise a parent key handler can capture
every embedded App's keys. After activation, one owner handles the gesture;
avoid double toggles between YA and Plannotator's frame listeners.

### Existing CLI sessions and alternative adapters

The CLI is a second candidate when already running a Plannotator review:
present its UI through the existing app path and let that invocation receive
its feedback once. CLI JSON is not automatically a structured YA comment-set
API, and return to the launching tool is not the same as a new session turn.
Do not both deliver CLI feedback and inject a duplicate YA message. Generic
viewed artifacts should not require an agent to start a blocking review tool.

If the library trial fails, record the concrete failed criterion and choose
between the direct DOM route below, a narrow fork, and selective component or
design reuse. Reuse YA's editor/draft primitives where appropriate. Avoid a
full parity rewrite without a demonstrated need or regex HTML rewriting.

## Session-authored proposal rounds and user responses

**User-directed scope clarification, 2026-09-21:** these are questions,
comments and suggestions directed **by the originating session to the user**
as it presents a revision-round proposal. They include advance justifications
and highlights, not only spatially located user feedback. An optional producer
skill generates the prelabelling. It is not a required step for ordinary
artifact viewing, and this plan does not create or install that skill yet.
Contributing-model: 6-Astra

Proposed interchange adds a round id, artifact revision, optional previous
round id, and ordered annotations with stable ids, target ids, author role
(`agent` or `user`), kind (`question`, `suggestion`, `justification`, `comment`,
`highlight`), body, and optional reply-to id. Display-name provenance is
separate from role. The trusted host associates the round with its originating
session; an artifact cannot grant itself a destination or impersonate a user.

The producer skill supplies meaningful target ids and source mappings, asks
specific questions, and labels rationale or emphasis as such. It declares
which questions expect answers; commentary and highlights require no answer.
Empty prelabelling is valid. The viewer neither invents questions nor runs an
agent to populate the surface. This is a concrete artifact-review use case;
it does not unbank the broader [rich interviews](../../topics/rich-interviews.md)
proposal or require its general form/interview engine.

Agent annotations and user annotations differ visibly in border/background
and spatial highlight style, with text/icon role labels so color is not the
only signal. Preserve the distinction in dark/light themes and touch layouts.
A user answer is a new user record linked to the agent question; it does not
overwrite the question or silently convert an agent suggestion into user
approval. Allow free comments, explicit answers, and explicit accept/reject
responses where the producer offers suggestions. Unanswered, skipped and
answered questions remain distinguishable; skip is not acceptance.

Round completion submits the user's responses with enough frozen question,
target and revision context for the session to understand them. Do not export
all prelabels as if they were new user instructions. Preserve role attribution
when including rationale or agent text as context. New proposal rounds have
new identities: keep previous responses associated with their original
revision, and offer explicit carry-forward rather than reattaching silently.

Default delivery remains **Send responses/comments** for the entire round.
Also support a declared **send-on-complete** mode, visibly chosen by the user:
the explicit Done/Complete action sends once to the bound session. Completion
is not blur, typing the last character, closing the viewer, or a producer-fired
DOM event. A producer may request the mode but cannot send unapproved drafts.
For intentional per-comment immediate delivery, label the editor action
**Send comment** and mark that item delivered so later batch completion cannot
send it twice. Draft hooks and completion hooks share the same YA delivery
owner and snapshot/failure semantics as the batch workflow.

## Direct artifact DOM convention and gradual producer support

Authored HTML/SVG can carry the mapping and annotation attachment points
directly, rather than relying on reverse inference. Candidate convention:
an element has a stable target id, a bounded inline source span or reference
to a source-map entry, and annotation ids that resolve to declarative records
in embedded JSON or a sidecar. A shared review runtime decorates those targets
and connects user drafts, replies and completion actions to the host bridge.
The names/schema need a prototype; this is not yet a published wire format.
Prefer data records and a small shared adapter over custom executable handlers
on every element. Hooks request actions; they contain no session credentials.

Gradual onramp, each useful independently:

1. Ordinary artifact: existing view and whole-document comment context.
2. Target ids/source spans: precise quoting and click-to-comment, including SVG.
3. Agent annotation records: prelabelled questions, suggestions and rationale
   with role-distinct markers and user replies.
4. Round metadata/completion hooks: retained drafts, response batching and
   explicit send-on-complete to the originating session.
5. Optional richer hit regions, source-map chaining and revision carry-forward.

Producer effort can be small because each level is declarative and the shared
runtime supplies interaction. Plannotator-level behavior is not free: anchor
restoration, accessible editors, rendering isolation, delivery correctness and
revision handling still need implementation and tests. Compare actual adapter
complexity on one fixture; do not pursue parity as an end in itself.

## Intended interaction and submission

1. A default-available accelerator or visible **Comment** action invokes review,
   including first-use acquisition, with no settings prerequisite. Opening
   ordinary artifacts keeps native interaction. Use the shortcut audit above
   to select a browser-compatible binding; then click to target. A modifier-click
   is optional convenience after that audit, never the
   only entry; avoid stealing Ctrl/Cmd-click new-tab and Shift-selection.
2. A text selection anchors exactly that passage; a collapsed caret anchors
   its enclosing source/rendered block. Pointer targets can be elements or
   image regions. Open a nearby editor without covering the target; narrow
   layouts may use a sheet. Escape dismisses the editor/mode without sending.
3. **Quote reply** inserts the captured quote/location into the originating
   session composer at its remembered caret (append if no caret is available),
   retaining existing draft text and undo. An element without text contributes
   an honest element/region description, not a fabricated quotation.
4. **Add comment** saves an item in the review set. Enter/newline and explicit
   Add behavior must be clear in the editor; neither blur, focus transfer,
   minimize, close nor session navigation sends this new review set. Show a
   count/list with edit, remove and return-to-anchor actions.
5. **Send N comments** previews the destination and sends one ordered user
   message through YA's existing session send/queue path. The main composer
   is untouched. Freeze the submitted snapshot; preserve edits made in flight.
   Failure retains drafts. Prevent repeat clicks; if acknowledgement is lost,
   use the existing request identity/receipt mechanism if available, otherwise
   report uncertain delivery rather than silently retrying.
6. Draft ownership is the source/server identity + canonical YA session id +
   project + artifact identity, never whichever session is currently visible.
   Restore locally after viewer closure; show the destination when reopening.
   Handle a deleted/unavailable destination explicitly; never redirect silently.
   Keep storage bounded and outside project files, following
   [project storage](../../topics/project-directory-storage.md).

## Context and locating non-text targets

One captured target record accompanies each comment. Proposed fields: stable
artifact identity/path, capture-time content hash or revision, resource/page
within the artifact, anchor kind, quote if any, rendered element context,
optional exact source span, normalized geometry, runtime-state/trace checkpoint,
and user text. Keep source
identity and session routing in trusted YA state. Omit bearer grant URLs from
provider text; those are credentials, not durable source citations.

Distinguish **exact source**, **rendered element**, and **visual region** in
the review UI and submitted context. A DOM selector is not a source map.

**User-directed mapping direction, 2026-09-21:** prefer source mappings emitted
when generating artifacts under our control over reconstructing source from
rendered HTML. Plannotator can own target selection and comment editing while
YA resolves the selected target through artifact-authored metadata. Source
maps are allowed in either integration; exact mapping need not depend on
Plannotator's own HTML-to-source inference.
Contributing-model: 6-Astra

For generated artifacts, emit stable target ids on HTML/SVG elements or
semantic groups and versioned inline or sidecar metadata mapping each id to
the original source path, content hash, offsets or line/column range, and optional semantic
label. Keep generated-output spans distinct from original authoring spans.
Record repeated-instance identity separately from the shared template span.
The annotation adapter must preserve the target id through selection and
submission; prove this seam rather than assuming Plannotator exports arbitrary
attributes. The resolver may follow build source maps where a generated-code
location is available, but still needs the element-to-code association.

The mapping belongs to the artifact-generation/export step, travels with the
artifact and describes that exact build. Treat paths as references subject to
existing file-access checks, never new authority to read files. Keep metadata
bounded, and do not ship private source contents merely to supply locations.
For imported artifacts without metadata, use parser alignment when reliable,
then rendered-element or visual-region context. This fallback does not reduce
the fidelity available for artifacts we generate.

| Content | Capture and mapping plan |
| --- | --- |
| Text/Markdown/source | Reuse aligned source offsets, quote and nearby lines from the current selection machinery. Preserve repeated-text disambiguation. |
| Static HTML or inline SVG | Hit-test inside the cooperating frame and resolve emitted target ids through the generation-time map first. Otherwise use semantic element/id, enclosing group, label and a bounded outline; a source-offset parser may map the original immutable document. Instrument only generated artifacts or the review copy; never rewrite an imported author's file. |
| Script-generated DOM/SVG | Prefer emitted author/build metadata, validated against the loaded revision, with target ids preserved across runtime creation. Otherwise capture rendered context. A runtime node or React component name alone does not identify its authoring line. |
| SVG loaded through an image element | The outer page sees the image, not its internal paths. Annotate a normalized region initially; exact SVG targets need a dedicated isolated SVG document view or an author-supplied mapping. Handle transforms, viewBox, nested groups and use/instance ambiguity. |
| Raster image, canvas or WebGL | Store region coordinates in intrinsic content space plus dimensions and a retained crop/snapshot when supported. Canvas pixels have no generic mapping back to drawing-source code; require explicit hit-region metadata for exact source attribution. |
| Uncooperative external app or inaccessible nested frame | Offer whole-artifact context or an explicit screenshot-region workflow. Do not pretend parent listeners can inspect its DOM. |

Capture viewport, zoom and scroll interpretation where needed; screen pixels
alone are not a durable anchor. Re-resolve against the capture revision. After
reload/content changes, retain the old quote and mark unresolved or ambiguous
anchors for review; never silently attach them to a similarly placed element.
Bound excerpt, context and screenshot sizes. For a visual-only comment the
agent must receive the image/crop through a supported attachment path, not
just a client-local blob URL. Initial text/element support may defer crops
explicitly if that path is unavailable.

### Dynamic state and reproduction history

Optional checkpoint accelerators, large replay payloads passed by file/reference,
approximate input recipes, and framework-level interception now have their own
[replay checkpoint sketch](artifact-replay-checkpoints.md). A verified state
checkpoint may replace a long causal prefix with a short suffix; detailed
metaprotocol and library choices remain TBD. This is an optional enrichment,
not a prerequisite for the generic reproduction recipe below.

**User-directed extension, 2026-09-21:** a fully dynamic App needs more than
source mapping. Comments may describe a state reached through interaction,
such as an open menu, and need a growing reproduction history that includes
the source-map facts applicable at each step. A location in code alone does
not identify the displayed state being reviewed.
Contributing-model: 6-Astra

Use a shared, bounded trace per review round, growing as the user exercises
the App. An annotation freezes a trace checkpoint plus its selected target
and visible context, so later actions do not change what that comment means.
Multiple comments can reference one trace prefix rather than copying the
whole history. Preserve checkpoints needed by unsent comments when compacting;
if a limit prevents further capture, show that limitation rather than silently
dropping the setup required to reproduce an existing comment.

**User-directed fidelity clarification, 2026-09-21:** generic artifacts need
useful, fixed-pixel-dimension reproduction instructions. Exact source-level
attribution and elegant semantic traces are optional capabilities of
intentionally structured artifacts that prelabel generated objects in-band
or out-of-band. Do not make arbitrary-artifact review depend on recovering
source maps, application state or semantic object identities from pixels.
Contributing-model: 6-Astra

Use two additive levels:

- **Generic reproduction recipe:** capture the exact artifact revision/entry,
  starting route, inner content viewport width/height in CSS pixels, device
  pixel ratio and resulting screenshot dimensions, browser zoom and artifact
  zoom, scroll offsets, and available browser/environment facts. Record ordered
  pointer coordinates relative to that viewport, key actions and observable
  checkpoints, together with a screenshot of the commented state. Instructions
  recreate the same content viewport, not merely the outer browser window or
  right-pane width. Include explicit reset/setup and waits where known, plus
  missing setup or nondeterministic inputs where not known. This is the
  baseline even when no object/source metadata exists.
- **Structured artifact enrichment:** stable generated-object/instance labels,
  source spans/maps, semantic actions and state checkpoints replace brittle
  coordinate steps where available. Accept inline DOM/SVG attributes, an
  embedded object registry, or sidecar maps; canvas objects can expose hit
  regions through the same convention. Labels alone improve target naming;
  exact source and restorable state require their respective extra metadata.
  Producers can adopt these capabilities incrementally.

Aim for deterministic reproduction by fixing controllable dimensions and
setup, but equal pixel dimensions alone cannot guarantee equal runtime state
or pixels. Mark a recipe replay-verified only after testing it against the
pinned build with its necessary inputs. If generic event capture is unavailable
across the frame boundary, accept reviewer-supplied steps and identify that
coverage; do not fabricate a trace. This does not block commenting.

Example: load revision R → choose item A → open Actions → open Export submenu
→ comment on the disabled SVG option. Capture its screenshot/coordinates and
the actions reaching it; add its stable target, source span and semantic
menu/selected-item state when the artifact supplies them. Closing
the menu afterwards must not orphan the comment or rewrite its description.
Returning to the comment can show its captured state, or deliberately restore
that state when safe; scrolling to a now-absent selector is insufficient.

The enriched trace records a starting route/checkpoint, ordered semantic
actions and outcomes, target/instance ids, relevant state transitions, and
revision/source-map identity. Producer-provided hooks can expose menu state,
selected records, component state or hit regions without guessing from DOM
events. Pointer/keyboard events and a screenshot/DOM summary are a fallback,
not a guarantee of replay. Async responses, timers, randomness, changing data
and server state may require fixture inputs or explicit state serialization.
Distinguish a human-readable reproduction recipe, a visual/state snapshot,
and tested deterministic replay; claim only the level actually supported.

Start capture when the user enters review, or use a separately enabled bounded
pre-review buffer. If the user already opened a menu, capture the current
state as the starting checkpoint and mark earlier setup unknown. Keep state
hooks optional so an ordinary producer can start with target/source metadata
and later add semantic action/state capture. A build change starts a new
trace segment with its own mapping facts; never resolve historical steps using
only the newest source map. Submitted comments preserve the referenced segment
or an immutable retained record the agent can access.

Record only the inputs/state needed for review, with producer allowlists and
limits; exclude credentials and sensitive form values. Replay is opt-in and
isolated or demonstrably side-effect-free: opening a menu can be replayable,
but arbitrary clicks may submit forms or mutate external services. A failed
restore leaves the snapshot and reproduction recipe available. No background
session recording or browser automation authority follows from viewing an App.

Extend the deciding trial with a menu/submenu target created only after
interaction, two comments at different states, an asynchronous state change,
and a new build. Verify both comments reach the session with their own frozen
state, recipe and available source facts after the menu closes. Test an
unstructured artifact with fixed-dimension coordinate instructions and a
structured artifact with object-labelled semantic steps against the same
interaction. The generic case must remain useful without source metadata;
the structured case must demonstrate its stronger attribution/reproduction.

## Bridge and optional new-tab return

Any annotation bridge is a deliberately new, bounded protocol under the
active-content contract. It may propose target data and reflect marker state;
it cannot execute commands, select arbitrary sessions, read YA storage, or
send provider input. Validate window source, expected origin where meaningful,
per-view instance/channel, schema and size. Opaque frames require a scoped
channel rather than treating the shared `null` origin as identity. All frame
data is untrusted even when its origin matches. YA chrome owns Send.

Keep current artifact isolation and granted-root resource access. Do not
adopt an unsandboxed live-view mode or enable scripts in scriptless viewing
without reviewing that explicit contract change. Pin both bridge and host
versions; unavailable/mismatched bridges leave a readable viewer with a clear
annotation limitation. Stop listeners/observers on teardown; no idle polling.
Any new server route/field needs the existing capability and hosted-client
compatibility review before implementation.

The cheap new-tab candidate is a **YA-owned review route**, opened by a user
gesture, embedding the same isolated artifact with an authenticated review
destination and a **Back to session** link. It uses canonical YA session and
source identity, not a provider thread id. Keep `noopener`; do not rely on an
opener surviving or transfer session credentials into the artifact. A raw
artifact tab has no YA authority and need not gain commenting in v1.
If source selection, authentication or draft sharing makes the wrapper a
substantial project, ship the right-pane workflow first and leave this item
explicitly deferred. Mere artifact possession is never submission authority.

## Artifact-owned Submit transport (2026-09-25 discussion)

User-directed addition; discussion only, not an implementation request.
Contributing-model: 6-Astra.

A paper-review artifact now collects source-anchored proposals, decisions and
selected-text notes in the full rendered manuscript. Manual Copy feedback →
paste into the session is sufficient for the current submission deadline.
The missing convenience is an explicit **Submit** action inside that artifact,
usable in play mode across iframe/host arrangements and, if feasible, a
standalone tab. Ordinary text selection and copying must never send a turn.
This transport can support an artifact's own review UI without waiting for
YA's full annotation adapter or Plannotator integration.

Two candidate transports remain open:

- **Registered clipboard prefix.** YA associates a fresh, artifact-specific
  prefix with one destination session. Artifact JavaScript writes that prefix
  plus a structured payload when the user chooses Submit. A cooperating YA
  client recognizes only an active registration, validates the envelope,
  removes the transport prefix, and submits the payload to that session.
  Copy feedback remains an ordinary copy action; only Submit writes the
  submission envelope. Registration lifetime, clipboard observation and
  acknowledgement are part of the missing facility, not assumed browser
  capabilities. Prove permissions, focus and frame/tab behavior on supported
  browser/native clients before selecting this route. Do not introduce
  perpetual clipboard polling or ingest unrelated clipboard contents.
- **Scoped submission URL.** Supply the artifact with a bearer capability
  whose sole authority is to submit bounded feedback to one session. This
  offers a direct request/acknowledgement path without using the clipboard.
  Prove actual reachability, CSP/CORS, sandbox and direct/relay behavior;
  neither a fetch call nor a URL alone establishes those properties. Keep
  the capability separate from view grants and owner/wake credentials.

Use the [principals-and-grants vocabulary](../../topics/principals-and-grants.md):
the prefix or bearer identifies a bounded submission grant; the delivery
route supplies no additional authority. An ordinary text prefix is only a
delimiter, not proof of the author or of a user gesture. Registration must
therefore explicitly authorize the cooperating artifact's submission channel.
Bind the destination in YA, not in arbitrary payload text. Consider expiry,
revocation, payload limits and an envelope with submission ID, artifact/review
generation and feedback. Duplicate clipboard observations or request retries
must not create duplicate turns. Preserve drafts through failed or uncertain
sends, acknowledge accepted submissions, and leave unrelated composer text
untouched. Do not leak capability material into the turn or committed artifact.

This candidate deliberately extends the earlier “YA chrome owns Send” design:
the artifact may request a send through its explicitly registered capability.
It does not grant arbitrary session access or ambient YA authority. The
current active-content contract remains unchanged until a later authorized
implementation updates and verifies that boundary. Manual paste stays the
fallback, and no roadmap priority changes with this discussion.

A deciding trial should use the current paper-review artifact and verify:
ordinary copy does nothing; explicit Submit reaches exactly the registered
session once; copied/retried/stale envelopes do not resend; two open artifacts
cannot cross-route; expiry and denied clipboard/network access retain the
feedback; and the declared iframe and standalone-tab configurations work.

## Implementation sequence and acceptance

1. **Prove the annotation adapter.** Isolated fixture with selectable text,
   textless inline SVG, a relative asset/module and a dynamic target. Exercise
   Plannotator callbacks, returned context, loaded-version compatibility and
   native interactions while disabled. Include a generated target id and
   sidecar span, proving that a Plannotator selection resolves back to the
   original source independently of its own source inference. Check actual
   installed/published APIs and preserve a small feedback specimen without
   private content. Preload an agent question, suggestion, justification and
   highlight; answer and add a
   user comment. Verify role styling on both targets and cards, reply ids and
   lossless source mapping. Compare the library path with the minimal authored
   DOM convention. Then run the project-template App trial above; a static
   fixture alone is insufficient. Prefer Plannotator plus small upstreamable
   seams, choosing a fork or direct adapter only from demonstrated blockers.
2. **Connect the session review set.** Add the default-available invocation at the managed
   viewer boundary, a captured-target adapter, and explicit draft/set state.
   Reuse `ReviewCommentEditor`, snapshot-clearing logic and
   `SessionViewerCommentContext` where their contracts fit. Do not reuse the
   existing auto-flush lifecycle. Prove text quote reply and one batch of mixed
   text/element comments to the correct session before adding exact SVG maps.
3. **Add generation-time mapping and imported-artifact fallback.** Wire the
   proven target-id mapping into the owning artifact exporter. Test original
   versus generated spans, repeated instances, build-map chaining, stale hashes,
   duplicate text, dynamic nodes, image SVG, transformed geometry and reload.
   Preserve frozen context on source edits. Prove exact mapping for a generated
   SVG part and useful context for an imported artifact with no mapping. Add
   the bounded runtime trace and per-comment state checkpoints; exercise the
   menu/submenu reproduction case before calling dynamic App review complete.
4. **Verify delivery and lifecycle.** On a clean profile without harness skills
   or a global Plannotator install, invoke once and verify loading/provisioning,
   review startup and YA-owned callbacks. Reinvoke during loading, cancel,
   retry a failed acquisition and reuse the cache. Verify no acquisition or
   provider work before invocation. Check actual Windows/Linux keyboard events
   with focus in host chrome, editable fields and cooperating/uncooperative
   frames, including AltGr and browser shortcut conflicts.
   Real browser tests over direct and
   hosted-relay paths, covering two sessions viewing the same artifact,
   navigation/minimize/restore, draft recovery, failed/uncertain sends, in-flight
   edits, hostile frame messages, bridge failure and revoked artifact access.
   Existing text Comment mode and ordinary artifact controls must retain their
   current behavior. Inspect 1200×600 and 375×812 captures through the artifact
   capture facility. Sequential typing in both comment editor and main composer
   during a 240-message live session must lose no keystrokes and acknowledge
   each within 100 ms. Verify agent prelabels are never submitted as user
   approval, skipped questions remain skipped, and old-round replies never
   migrate silently. Exercise both batch submission and user-chosen explicit
   send-on-complete, including immediate-item deduplication. Run normal
   client/server checks for the changed paths.
5. **Try the tab wrapper only if cheap.** Prove reload and Back to session on
   the same authenticated YA source, plus opener-closed behavior. Otherwise
   record it as deferred; it does not block right-pane acceptance.

Done means the originating session presents a revision with spatially attached
questions, suggestions and commentary; agent and user marks are distinguishable.
The user answers a question, comments on a textless SVG part and a text passage,
and completes the round in one turn to that session while preserving composer
text. Focus changes never send. A new revision cannot misattribute old answers.
Comments on transient menu states retain their captured state, reproduction
steps at the recorded pixel dimensions and any available matching source facts
after that UI disappears. Unstructured artifacts remain reviewable without
semantic or source-map support.
An exact source citation is required only when demonstrably mapped; otherwise
the received context explicitly names the rendered element or visual region.

Why not a direct fix: iframe cooperation, target provenance and deliberate
batch lifecycle cross existing isolation and input-ownership contracts. The
user authorized an actionable plan; no runtime dependency or protocol change
is necessary to deliver that plan. Roadmap priorities are unchanged.

Found 2026-09-21 while planning user-requested artifact quote replies and
batch comments with possible exclusive Plannotator UI reuse.
Contributing-model: 6-Astra
