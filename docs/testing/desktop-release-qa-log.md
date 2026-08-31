# Desktop release QA log

This log records end-to-end checks against published desktop artifacts on the
macOS and Windows testbed VMs. Add a dated section for each release exercise so
installer, provider-session, publication, and updater results remain
discoverable after the release is complete.

Result meanings:

- **PASS** — the observable behavior completed as expected.
- **FAIL** — the observable behavior did not complete as expected.
- **BLOCKED** — the check needed a user-owned credential or secure-desktop
  action that was not available during the run.
- **NOT RUN** — the check was outside the completed scope; the reason is noted.

## 2026-08-31 — `desktop-v0.2.0`

### Scope and release identity

The run exercised the existing public `desktop-v0.1.3` application, published
`desktop-v0.2.0`, and completed signed automatic upgrades on the macOS and
Windows testbed VMs.

- Previous release: `desktop-v0.1.3`
- New release: `desktop-v0.2.0`, commit
  `8ee821313dbac129f55219fd1aeff68234a602b4`
- Release page:
  <https://github.com/kzahel/yepanywhere/releases/tag/desktop-v0.2.0>
- Release workflow:
  <https://github.com/kzahel/yepanywhere/actions/runs/33385313018>
- Post-release updater hardening: commit
  `c970af7fa6ec682303bc93134baa14b70d3de00a`
- Test hosts: dedicated Apple Silicon macOS and Windows 11 ARM64 VMs; Windows
  exercised the published x64 shell and its native ARM64 bundled runtime

All guest inspection, capture, input, installation, and protected-desktop
consent used target-internal Machine Control routes. Accepted desktop actions
reported `hostInterference: none`; no host display or input route was used.

### Result summary

| Check | macOS | Windows |
| --- | --- | --- |
| Public signed `0.1.3` baseline | PASS | PASS — primary per-user NSIS |
| Signed feed advertises `0.2.0` | PASS | PASS |
| Automatic update window foregrounded | PASS | PASS |
| Signed download, install, and relaunch | PASS | PASS after feed repair |
| Installed app reports `0.2.0` | PASS | PASS |
| Packaged runtime starts; dashboard returns HTTP 200 | PASS | PASS |
| Native runtime selected on ARM64 | PASS | PASS |
| Existing project and session state preserved | PASS | PASS |
| Windows remains a non-elevated NSIS install | N/A | PASS after feed repair |
| Explicit Quit removes the app and bundled runtime | PASS | PASS |
| Tagged release workflow | PASS | PASS |

### Release construction and CI

The release candidate incorporated a contributor's latest pushed changes
before the version commit and tag were created. Local release checks passed
with no warnings: desktop script tests, 24 Rust tests, Clippy, repository lint,
and formatting. Desktop CI passed for Apple Silicon macOS, Intel macOS, and
Windows. The general CI run's single FileViewer timing failure passed ten
isolated repetitions and its failed job passed on rerun.

The post-release metadata fix added three normalization tests, bringing the
desktop script suite to five passing tests. Repository lint and formatting
remained clean. Both general CI and Desktop CI passed on the exact hardening
commit:

- <https://github.com/kzahel/yepanywhere/actions/runs/33390280466>
- <https://github.com/kzahel/yepanywhere/actions/runs/33390280467>

### Published artifact checks

| Artifact | SHA-256 | Guest validation |
| --- | --- | --- |
| `YepAnywhere_0.2.0_aarch64.dmg` | `e4feaa1caed8f2d45ce6bdcd4e38f2817df0ea64ae613f11303b11abf6d9035b` | Gatekeeper acceptance, strict code signature, automatic update |
| `YepAnywhere_0.2.0_x64-setup.exe` | `e4c8d82d8075f7f216deae74e8b4a72d30fcbcdf5841d4106ab93c0d880a323f` | Valid Authenticode-installed app, signed automatic update |
| `YepAnywhere_0.2.0_x64_en-US.msi` | `5c6c016c1fac96491bda54ab41bcd6428943016e1f9fe7bc5f1b198e3f59115e` | Initially published; removed after it exposed the elevated feed path below |

The public updater route returned version `0.2.0`, a nonempty signature, and
the matching platform artifact. After repair, canonical
`windows-x86_64` metadata is identical to `windows-x86_64-nsis` and resolves
to the setup executable. A follow-up maintainer decision removed the MSI asset
and updater record entirely so the release has no elevated installer path.

### macOS automatic update

The public signed `0.1.3` application passed Gatekeeper and strict code-sign
verification, launched one bundled runtime, and served the existing Projects
dashboard. Its automatic update window offered `0.2.0`; selecting **Install
and Restart** downloaded the signed updater archive and relaunched a new app
process at `0.2.0`. Gatekeeper and strict signature verification still passed,
the dashboard returned HTTP 200, and the existing project and session were
present. Explicit target-internal Quit left zero app and bundled-runtime
processes.

### Windows updater finding and repair

The first `0.1.3` NSIS-to-`0.2.0` update selected Tauri's canonical
`windows-x86_64` entry, which pointed to the all-users MSI. The MSI required
UAC and installed a healthy signed `0.2.0` application, including the native
ARM64 Bun fix, but it left both a stale per-user `0.1.3` NSIS registration and
a machine-wide `0.2.0` MSI registration. This violated the primary per-user
NSIS installation contract.

Commit `c970af7fa` first normalized generated updater metadata so the canonical
Windows entry copied the signed NSIS entry. After the maintainer confirmed
that no elevated installation path was desired, Windows packaging became
NSIS-only, release finalization began rejecting MSI artifacts and metadata,
and the MSI was removed from the public `desktop-v0.2.0` release. The public
`latest.json` asset was repaired in place. No application binary or signature
changed.

The mixed test installation was then removed without touching desktop data,
and the public `0.1.3` NSIS baseline was installed again. Its installer and
installed app had valid Authenticode signatures and exactly one per-user
`0.1.3` uninstall registration. The automatic updater again foregrounded
`0.2.0`; **Install and Restart** completed while eight consecutive internal
desktop observations remained on the ordinary `Default` desktop, with no UAC
transition.

The relaunched application had all of the expected release properties:

- app version `0.2.0` with a valid Authenticode signature;
- exactly one app process and one bundled Bun process;
- `bun-windows-aarch64.exe`, SHA-256
  `c48ea01208766207606927a320d640371140dca51e9963367779b32d18460716`;
- dashboard HTTP 200;
- exactly one `0.2.0` per-user NSIS uninstall registration and no MSI
  registration; and
- the existing project and session still visible after relaunch.

Explicit target-internal Quit then left zero app and bundled-runtime
processes. This completes the automatic download/install portion that the
`desktop-v0.1.2` QA run had left as required follow-up.

## 2026-08-01 — `desktop-v0.1.2`

### Scope and release identity

The run began from the then-current public release, `desktop-v0.1.1`, and
exercised a fresh install, launch, session creation, publication of a new
release, and the update path on the macOS and Windows VMs.

- Previous release: `desktop-v0.1.1`, commit
  `02856e2cbe0edae579309ddb747ca8164a0682d3`
- New release: `desktop-v0.1.2`, commit
  `ea22d209170437d0b417504777d7dfad010d5eb1`
- Release page:
  <https://github.com/kzahel/yepanywhere/releases/tag/desktop-v0.1.2>
- Release workflow:
  <https://github.com/kzahel/yepanywhere/actions/runs/30698924933>
- Test hosts: macOS 26.2 arm64 in Tart; Windows 11 Pro
  `10.0.26200` arm64 in UTM, running the published x64 build under Windows on
  ARM emulation

The shared source checkout contained concurrent work. The release commit was
made with an exact path list, checked from a detached temporary worktree,
pushed, and tagged by exact commit so unrelated worktree changes were not
included.

### Result summary

| Check | macOS | Windows |
| --- | --- | --- |
| Existing app and desktop data absent before test | PASS | PASS |
| `desktop-v0.1.1` artifact digest and publisher signature | PASS | PASS |
| Fresh primary install | PASS | PASS |
| First launch starts the bundled runtime | PASS | PASS |
| First-launch dashboard visually verified | PASS | PASS |
| Create a session record from the dashboard | PASS | PASS |
| Receive a live provider response | BLOCKED — Claude OAuth was expired | BLOCKED — Claude OAuth was expired |
| Publish `desktop-v0.1.2` from the exact release commit | PASS | PASS |
| Release CI build and finalization | PASS | PASS |
| Signed updater feed advertises `0.1.2` to `0.1.1` | PASS | PASS |
| Automatic `0.1.1` to `0.1.2` upgrade | FAIL — no updater window surfaced | FAIL — no updater window surfaced |
| Manually install and launch published `0.1.2` artifact | PASS | PASS |
| `0.1.2` manual update check foregrounds its result | PASS | PASS |
| About distinguishes desktop and bundled YA versions | NOT RUN | PASS |

### Current-release installation details

On macOS, `/Applications/YepAnywhere.app` and the desktop data directory were
absent before installation. Generated desktop data, WebKit state, caches, and
application-support state from an initial probe were moved to the recoverable
guest backup
`/Users/admin/QA-Backups/desktop-0.1.1-pre-clean-20260801T1200/`; `0.1.1` was
then relaunched from a clean desktop state. Existing external `~/.claude`
provider history was deliberately preserved. An old, inactive
`com.yepanywhere.plist` launch-agent file was also left untouched.

The macOS `0.1.1` DMG matched SHA-256
`758039b5a04fdfdc6842df396d05330570e99e360607a374b0a7a16e3f696d95`.
Gatekeeper accepted the installed app as a notarized Developer ID build,
strict deep code-signature verification passed, and the bundled Bun retained
only the required `com.apple.security.cs.allow-jit=true` entitlement from the
checked set. The app launched its bundled server and opened the Projects
dashboard.

On Windows, the app, its installation directory, and the desktop data
directory were absent before installation. The `0.1.1` NSIS installer matched
SHA-256
`d8fa22f36bc0dd6b6a25cb637d7fa1a4ae427e3f461b0933e05354b357c04ff8`,
had a valid Kyle Graehl Authenticode signature, completed a quiet per-user
install with exit code zero, and started the desktop shell and bundled Bun
runtime. After the disposable guest was unlocked, the dashboard rendered and
showed the external provider history that was deliberately preserved outside
the clean desktop data directory.

Both installed `0.1.1` apps reported desktop version `0.1.1`, bundled YA
version `0.7.0`, commit
`02856e2cbe0edae579309ddb747ca8164a0682d3`, and Bun `1.3.14`.

### Session check

The clean macOS dashboard created and opened a new session record. The prompt
was submitted, but the provider turn returned `Failed to authenticate: OAuth
session expired and could not be refreshed`. A direct
`claude auth status --json` check had reported a logged-in CLI, making the
failed refresh an environmental credential issue rather than a desktop
installer or session-record failure. No credential was requested or entered by
the QA driver.

The Windows dashboard also created, opened, and persisted a new session record.
Its provider turn reached the same explicit `Failed to authenticate: OAuth
session expired and could not be refreshed` result. The installed Windows
Claude command had also failed to provide usable authenticated status during
the noninteractive preflight.

### Release construction and publication

The `0.1.2` release contains the two desktop fixes already staged under the
changelog's Unreleased heading: foregrounding updater results in a trusted
native window, and distinguishing desktop release identity from the bundled YA
build in About.

The exact release checkout passed:

- frozen dependency installation;
- lint with zero lint warnings;
- workspace typecheck;
- workspace tests, including 348 client files and 2,866 client tests;
- desktop script tests;
- packaged-runtime preparation and smoke (`protocol 1`, dynamic port);
- Rust `cargo check` after packaged-runtime preparation; and
- the existing client console budget at 110/110 with no increase.

The packaging preparation emitted existing dependency deprecation notices, a
Vite chunk-size notice, and a pnpm warning about creating a Vite binary link in
the deployed server tree. These did not prevent packaging or the packaged
runtime smoke, but they remain QA noise worth tracking.

All tagged workflow jobs passed: Intel macOS, arm64 macOS, Windows x64, and
release finalization. Both guest VMs independently fetched updater metadata
advertising version `0.1.2` with a nonempty signature and the expected
platform artifact URL.

### Published `0.1.2` artifact checks

| Artifact | SHA-256 | Guest validation |
| --- | --- | --- |
| `YepAnywhere_0.1.2_aarch64.dmg` | `9d4dcc0430315d527043bcc7cc33c8b97792eb2de5cabdc4f0d8584e92556944` | macOS digest, notarization, strict deep signature, Bun JIT entitlement |
| `YepAnywhere_0.1.2_x64-setup.exe` | `a1f7cf4a8a199524b0f3177d257440fdade495478080817d2299405853837379` | Windows digest and valid Authenticode signature |
| `YepAnywhere_0.1.2_x64_en-US.msi` | `7b3352346436acc42ea8678de443369536ae96a32997658b719a87d02205d1a7` | Windows digest and valid Authenticode signature |

The primary per-user NSIS installer was exercised. The secondary all-users MSI
was validated but not installed because that managed-deployment path requires
an elevated installation and was not needed for the requested application QA.

Because the `0.1.1` macOS update UI did not surface, the published `0.1.2` DMG
was installed manually after preserving the old app at
`/Users/admin/QA-Backups/desktop-0.1.2-manual-install-20260801T1230/`.
The app launched, retained the session record, and reported desktop version
`0.1.2`, commit `ea22d209170437d0b417504777d7dfad010d5eb1`, bundled YA
`v0.7.0-346-gea22d209`, and Bun `1.3.14`.

Windows exhibited the same `0.1.1` updater failure. The signed `0.1.2` NSIS
installer was therefore run as the documented quiet per-user recovery path.
It exited zero, updated the registered and executable version to `0.1.2`,
retained the new session record, and reported the same exact release commit,
bundled YA build, and Bun version. Settings → About visibly distinguished
`Desktop: v0.1.2` from `Bundled YA: v0.7.0-346-gea22d209`.

### Updater finding

The macOS `0.1.1` app was tested after the `0.1.2` feed became live in two
ways: a tray-menu manual check and a full app quit/relaunch followed by the
five-second startup-check interval. The guest could fetch the `0.1.2` updater
JSON directly, but neither attempt exposed an updater window or install
control. Only the dashboard remained in the accessibility window list. This is
a failed `0.1.1` to `0.1.2` user upgrade path on this host, not a successful
automatic update.

After the manual `0.1.2` install, the same tray action immediately foregrounded
a second native window containing `Updates` and `You are running the latest
version.` This verifies the visible effect of the `0.1.2` foregrounding fix,
but does not retroactively make the `0.1.1` to `0.1.2` upgrade successful. The
download-and-install portion of the corrected `0.1.2` updater must be exercised
against a later release.

Windows produced the same result. Both a direct `0.1.1` tray check and a full
quit/relaunch with the live feed exposed only the dashboard. After the manual
`0.1.2` install, the tray check foregrounded a second native window with the
same latest-version result.

### Follow-up required

- Reauthenticate Claude directly in each guest before requiring a successful
  live provider response.
- Treat the macOS and Windows `0.1.1` updater results as a release-distribution
  defect and decide whether users need explicit manual-upgrade guidance.
- On the next desktop release, test the corrected `0.1.2` updater through
  signed download, install, relaunch, version verification, and state
  preservation.
