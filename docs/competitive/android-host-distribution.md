# Android host distribution precedents

Reviewed 2026-10-30 using publisher documentation, public Play listings and
upstream source. No app installation, purchase, provider inference or private
store-console inspection was performed. The [host contract](../../topics/android-host.md#distribution-and-optional-phone-automation)
owns YA's product direction; this document records comparison evidence.

## Public distribution and installation

| App | Evidence checked | Relevance to YA |
| --- | --- | --- |
| [UserLAnd](https://play.google.com/store/apps/details?id=tech.ula) | Public Play listing describes first-launch downloads/setup of Linux distributions without root. Its [README](https://github.com/CypherpunkArmory/UserLAnd/blob/577851659b7570c79d7cee54e494ecdf5c908bb9/README.md) points to separate common and distribution asset repositories. | A phone-owned Linux installer can coexist with Play distribution; desktop staging is not intrinsic to Linux/PRoot. |
| [AiCLI](https://play.google.com/store/apps/details?id=tech.ula.aicli) by UserLAnd | Public listing explicitly offers Claude Code, Codex, Copilot and Gemini in Ubuntu. The [publisher setup guide](https://userland.tech/apps/ai-coding-tools/) documents first-launch Linux downloads and signing into providers with the user's own accounts. | Closest product precedent: Linux-hosted coding-agent CLIs, package installation and phone-local provider sign-in. |
| [Andronix](https://play.google.com/store/apps/details?id=studio.com.techriz.andronix) | Current listing describes in-app PRoot. [Version 10.1 migration docs](https://docs.andronix.app/install/standalone-and-termux) distinguish standalone Linux from the older Termux route; [installation](https://docs.andronix.app/install/in-the-app) downloads and unpacks the distro within the app. | Stronger comparison than treating Andronix only as a Termux installer. Publisher docs describe the current experience; no APK execution was verified here. |
| [Termux](https://play.google.com/store/apps/details?id=com.termux) | Public listing describes first-start base installation and later packages. The [Play maintainer](https://github.com/termux-play-store) explicitly records repaired PRoot support. | Android-native terminal/package environment with a separate Play implementation; its packages and Alpine's ABI are different. |
| [AnLinux](https://play.google.com/store/apps/details?id=exa.lnx.a) | Public listing explicitly requires Termux and uses PRoot for distributions. | Weaker packaging comparison: the Linux execution dependency is a separate app. Do not infer a standalone runtime from the Play listing alone. |
| [Buddy](https://github.com/ghorbelhamdi/buddy-android/blob/2e2ee71ab8748042cad7bf8a7c05191fc90dfbc7/README.md) | Refreshed README now recommends a direct Play link without the earlier tester-enrollment steps, and separates Play updates from GitHub APK updates. Source downloads verified Alpine and bundles PRoot libraries. | Very close Alpine/provider architecture. The direct Play page could not be retrieved in this review, so production/track availability was not independently confirmed. See the [original dated review](buddy.md). |

Listings establish public distribution claims and advertised behavior, not
Google's private review reasoning, feature-by-feature approval or successful
installation on every device/region. Live documentation can change independently
of a store binary. No specific listed binary was matched to a source commit.

## Source evidence and pins

- **UserLAnd:** `577851659b7570c79d7cee54e494ecdf5c908bb9`.
  Inspected `README.md`, `app/build.gradle` and
  `app/src/AiCLI/assets/apps/{claude,codex}/*.sh` through raw GitHub source.
  Gradle declares the separate `tech.ula.aicli` flavor; the launcher scripts
  invoke the respective provider tools. This pin is not a Play binary receipt.
- **AiCLI image builder:** `ea9b28f3114eb43a77591990c5ce67623aeae3d5`.
  Inspected [`input/main.sh`](https://github.com/CypherpunkArmory/UserLAnd-Assets-AiCLI/blob/ea9b28f3114eb43a77591990c5ce67623aeae3d5/input/main.sh)
  and `buildArch.sh`. Image construction installs Node through NodeSource and
  installs the provider packages globally with npm, including
  `@anthropic-ai/claude-code` and `@openai/codex`. Those commands run while
  constructing the image; do not describe them as a measured on-phone setup.
- **Buddy refresh:** `2e2ee71ab8748042cad7bf8a7c05191fc90dfbc7`.
  Inspected `Linux.java` and Play `Flavor.java`, alongside its public README.
  [`Linux.java`](https://github.com/ghorbelhamdi/buddy-android/blob/2e2ee71ab8748042cad7bf8a7c05191fc90dfbc7/app/src/main/java/app/buddy/assistant/Linux.java)
  pins Alpine 3.24.2, verifies SHA-256, extracts through a staging directory and
  runs APK-bundled PRoot/loader libraries against the downloaded filesystem.
  No upstream checkout was moved or binary imported.
- **Termux:** read the original pinned Play installer at
  `cf69df7a8d2a4c496f5b2464d0365a63a58716c5`. `TermuxInstaller.java` loads the
  bootstrap ZIP from the `termux-bootstrap` native library, extracts into a
  staging prefix and then installs it. Bundled bootstrap and downloaded Linux
  images are distinct precedents; see [Termux research](termux.md).
- **Andronix:** [component disclosure](https://docs.andronix.app/miscellaneous/source-code)
  names APK native libraries for PRoot/loader, talloc and android-shmem, and
  links source archives, build settings, hashes and notices at release
  [`standalone-2.1.0`](https://github.com/AndronixApp/andronix/releases/tag/standalone-2.1.0).
  This review read publisher disclosure/release metadata, not the full app's
  installation implementation, and did not reproduce its build.

## What follows for YA

The evidence supports pursuing an ordinary installable Play candidate. The
question is how to package and maintain YA's particular development environment,
rather than whether any Linux/PRoot/coding-agent app can appear on Play.

Our current APK contains the native shell and PRoot libraries. The separate
`host.py prepare` builds Alpine/Node/YA into `runtime.tar`; `stage` copies that
filesystem into `files/runtime` through debug ADB `run-as`. HostService requires
`opt/host/launch.mjs` and has no installer fallback. That is the concrete reason
a fresh APK alone cannot run YA. It is a development shortcut, not an Android
permission requirement or a proposed consumer setup step.

Evaluate a bundled/Play-delivered base against a verified in-app runtime
download. Preserve the existing split between replaceable runtime and persistent
provider homes, credentials, sessions and databases. Installer progress,
interruption recovery, integrity, available disk space, runtime/source version
receipts and update/rollback behavior need an explicit delivery contract.
Package the app, base runtime, YA and provider updates deliberately rather than
treating them as one updater. Keep exact native component source/notices and
provider redistribution terms attached to whichever artifacts YA distributes.
The source comparison does not grant redistribution rights.

Google's current [device/network policy](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)
still restricts external executable downloads and app self-updates. These
precedents do not establish a general PRoot exception or reveal how the policy
was applied to their payloads. Review the concrete YA build and updater, with
the precedents above as evidence. [All-files permission](https://support.google.com/googleplay/android-developer/answer/10467955?hl=en)
and foreground-service declarations remain separate submission questions.

Phone computer use is core behind an explicit app toggle, as clarified by the
maintainer. The [AccessibilityService automation policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
restricts autonomous planning/actions through that API; adding consent does not
remove that restriction. Continue with the existing MC/ADB direction and
investigate the actual revocation boundary, including already-running tools
and any independently available ADB credential. Shizuku is a relevant optional
setup comparison, not a selected dependency. Assistant invocation remains a
separate research direction.
