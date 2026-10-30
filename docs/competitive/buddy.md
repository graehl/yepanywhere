# Buddy Android

Reviewed 2026-10-18 through public source and project documentation only.
No installation, device experiment, inference run or store-console inspection.
Pinned source: [ffd2ec84c749](https://github.com/ghorbelhamdi/buddy-android/tree/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18); [reference manifest](android-host-references.yaml).

The [October 30 distribution follow-up](android-host-distribution.md) reads
newer source at `2e2ee71ab8748042cad7bf8a7c05191fc90dfbc7`. Its README now
recommends a direct Play installation link without the earlier tester steps;
track availability was not independently confirmed. The findings below retain
their October 18 source boundary.

## Product and relevance

Buddy is a phone-local assistant that combines real Claude Code, Codex and
OpenCode processes with a native chat/bubble interface and phone tools. Its
Alpine/PRoot runtime is directly relevant to [YA's Android host](../../topics/android-host.md).
YA keeps its existing server, full web UI and provider-owned sessions; Buddy's
native conversation UI and phone-control emphasis do not select a replacement
YA harness or interface. Source: [README.md](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/README.md).

## Runtime and phone-control boundary

[Linux.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Linux.java)
downloads/extracts Alpine into app storage, launches the APK-bundled PRoot
executable and loader, and provides commands with the guest environment.
Provider installation is separate from the app APK. PRoot uses the Android
kernel and the app identity; it is not a virtual CPU or a security boundary
against an unrestricted process under that same identity.

[McpServer.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/McpServer.java)
and [Tools.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Tools.java)
expose phone tools through local HTTP/MCP. The accessibility service supplies
screen observations and input actions. The API also includes confirmation,
questions, notifications and distribution-dependent APK/update operations.
[Guard.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Guard.java)
contains application-specific approval and autonomous-mode decisions. Their
presence does not establish independent enforcement against every possible
same-UID shell operation, nor compliance of autonomous AccessibilityService use.

## App updates and Play flavor

The [pinned README](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/README.md) reports Google Play
closed testing. Treat that as the maintainer's dated statement, not evidence
of production availability or Google approving every advertised capability.

[Play Flavor.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/play/java/app/buddy/assistant/Flavor.java)
and [Play manifest](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/play/AndroidManifest.xml)
separate distribution behavior: the Play flavor excludes self-updates, APK
installation and developer mode, and removes `REQUEST_INSTALL_PACKAGES`.
`Tools.java` both omits the relevant tool declarations and rejects those calls
in the Play flavor. This is a concrete channel split, not merely different
marketing text.

In the GitHub flavor,
[Updates.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Updates.java)
finds a newer release APK, downloads it, checks its package/version metadata
and opens Android's installer. The user confirms Update. This is an update of
Buddy's Android app itself, not a silent package replacement; provider CLI
updates are separate. Do not infer a bypass of Android signature enforcement.

The [YA host policy section](../../topics/android-host.md#distribution-and-optional-phone-automation)
owns the current policy interpretation. Removing updater/developer features
addresses specific concerns; it does not establish acceptance of the remaining
autonomous phone-control or native-code download behavior. Equally, do not
claim Buddy has no conceivable Play path when its source contains a Play flavor
and its docs report a closed test.

## Lessons and unanswered questions for YA

- Keep a useful phone-local coding host independent of phone automation setup.
- Reuse provider CLIs and focused sign-in instead of creating another agent loop.
- Separate app APK updates, guest/runtime updates and provider updates explicitly.
- Read service/guest readiness and shutdown behavior as design input; validate
  YA's own lifecycle independently before making screen-off or reboot claims.
- Optional ADB control remains YA's preferred advanced route; Buddy's
  AccessibilityService architecture is a comparison, not the selected baseline.
- Assistant-role invocation is separate from both the bubble and accessibility
  control. No assistant device experiment is authorized by this review.

## License and provenance

The app declares Apache-2.0; its fonts, icons and native components have their
own terms. [Bundled-component notices](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/third_party/README.md)
identify PRoot, talloc and Android shared-memory provenance. Read those exact
artifacts and sources before redistribution. No Buddy code, assets or binaries
were copied into YA by this research.
