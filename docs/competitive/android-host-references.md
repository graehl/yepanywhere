# Android host research references

Reviewed 2026-10-18. These sources support [YA's Android host topic](../../topics/android-host.md)
and the dedicated [Buddy](buddy.md), [Shizuku](shizuku.md) and
[Termux](termux.md) reviews. Shizuku, Termux and PRoot are adjacent platform
references rather than competing agent supervisors.

The [2026-10-30 distribution follow-up](android-host-distribution.md) adds live
Play listings for UserLAnd, AiCLI, standalone Andronix and AnLinux, with separate
source pins for the newly inspected UserLAnd/AiCLI and refreshed Buddy files.
The original checkout manifest below remains the October 18 snapshot.

## Reproducible source set

The tracked [YAML manifest](android-host-references.yaml) records repository
URLs, full commit IDs, repo-relative local paths, inspected paths and license
summaries. All nine checkouts were created at those exact detached commits
under gitignored `references/`. No upstream build, installer, package manager,
submodule initialization or device operation was run. A pin is a dated research
snapshot, not a claim that it is the newest release or an approved dependency.

| Checkout | Reviewed revision | Role |
| --- | --- | --- |
| `references/buddy-android` | [ffd2ec84c749](https://github.com/ghorbelhamdi/buddy-android/tree/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18) | Phone-local provider CLIs, Alpine/PRoot, native phone tools and distribution flavors |
| `references/shizuku` | [b844bc491f17](https://github.com/RikkaApps/Shizuku/tree/b844bc491f1790c72328e1a8e5b2349f8978f0ea) | User-started shell/root Binder broker, client authorization and lifecycle |
| `references/shizuku-api` | [a27f6e4151ba](https://github.com/RikkaApps/Shizuku-API/tree/a27f6e4151ba7b39965ca47edb2bf0aeed7102e5) | Matching Shizuku API gitlink, Binder lifetime, user services and rish |
| `references/termux-app` | [8629e632fcb9](https://github.com/termux/termux-app/tree/8629e632fcb95da272221be327db653fb24befe9) | Upstream terminal/service/bootstrap and channel comparison |
| `references/termux-packages` | [43a55ba76238](https://github.com/termux/termux-packages/tree/43a55ba7623859f5a58bb33b8c9b6bac529d16ad) | Upstream Android package build recipes and PRoot dependency provenance |
| `references/termux-play-apps` | [cf69df7a8d2a](https://github.com/termux-play-store/termux-apps/tree/cf69df7a8d2a4c496f5b2464d0365a63a58716c5) | Separate Google Play app implementation and bootstrap/service boundary |
| `references/termux-play-packages` | [57401119f998](https://github.com/termux-play-store/termux-packages/tree/57401119f9988f79fa095398a9b33b03380222b3) | Play-specific package recipes and PRoot exec interception adaptations |
| `references/termux-play-exec` | [47633d5df2db](https://github.com/termux-play-store/termux-exec/tree/47633d5df2db3dfea34cef568c6c82a7ba8dcc2e) | System-linker exec wrapper, shebang handling and limitations |
| `references/proot` | [25dc6a313489](https://github.com/proot-me/proot/tree/25dc6a3134891f98a79f57ce1c2c1b23ff15cad1) | Generic Linux syscall/path translation reference; not a shipped YA binary pin |

The Shizuku API pin matches the `api` gitlink in the Shizuku parent commit.
It is checked out separately for source reading; the parent's submodule remains
uninitialized. The generic PRoot pin is an architectural reference. Android's
Termux fork and package patches, Buddy's bundled notices, and YA's own runtime
artifact pins remain separate provenance; do not substitute this generic pin
for a shipped Android loader.

## Reading and refreshing

This follows JSTorrent's tracked-manifest/gitignored-checkout pattern, using
YAML here. YA's existing `pnpm references:sync` and `pnpm references:check`
currently manage **only Codex** through `scripts/clone-references.mjs`; they do
not consume this manifest. Extending that helper is outside this docs-only task.

For a missing checkout, take its URL, local path and full revision from the
manifest. For example, from the YA repository root:

```sh
git clone --filter=blob:none --no-checkout https://github.com/ghorbelhamdi/buddy-android.git references/buddy-android
git -C references/buddy-android checkout --detach ffd2ec84c7498c9e10e22889b4f4d1f52c293e18
git -C references/buddy-android rev-parse HEAD
git -C references/buddy-android status --short
```

These commands are for a new destination. For existing checkouts, inspect the
origin, HEAD and working tree first; never reset or replace local edits. Fetch
and detach at the exact manifest revision only after confirming that moving the
checkout will preserve local work. On Windows, run all Git commands through WSL.

Refresh pins deliberately: inspect upstream changes, update the full commit ID
and review date, and revisit affected source citations and findings together.
The branch name is discovery metadata; the commit ID owns reproducibility.
Check the Shizuku parent/API relationship again when either pin changes.

## Evidence and reuse boundaries

Project docs distinguish source-confirmed behavior, upstream claims, policy
interpretation and untested questions. Source reading is not device acceptance,
measured reliability, a successful production store review or a security audit.
Live policy/help URLs have a review date but are not immutable source pins;
recheck them before a submission or platform decision.

Read exact file/component licenses before any reuse. These checkouts authorize
research, not copying code, importing fixtures, linking libraries or distributing
binaries. Keep upstream sources out of YA commits and preserve the existing
provider/runtime ownership boundaries. No runtime dependency is added here.
