import { describe, expect, it } from "vitest";
import {
  compareSemver,
  getRemoteCompatibilityNotices,
  isStableReleaseVersion,
  isVersionLessThan,
  parseSemver,
} from "../remoteCompatibilityNotices";

describe("remoteCompatibilityNotices", () => {
  it("does not emit notices outside relay-hosted connections", () => {
    expect(
      getRemoteCompatibilityNotices({
        currentVersion: "0.4.28",
        latestVersion: "0.4.29",
        updateAvailable: true,
        resumeProtocolVersion: 2,
      }),
    ).toEqual([]);
  });

  it("emits a security notice for old relay resume protocol metadata", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.29",
      latestVersion: "0.4.29",
      updateAvailable: false,
      resumeProtocolVersion: 1,
      relayUsername: "dev-box",
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      "relay-resume-security",
    ]);
    expect(notices[0]?.severity).toBe("security");
  });

  it("falls back to version < 0.4.0 for relay resume security", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.3.9",
      latestVersion: "0.4.29",
      updateAvailable: true,
      relayUsername: "dev-box",
    });

    expect(
      notices.some((notice) => notice.id === "relay-resume-security"),
    ).toBe(true);
  });

  it("does not use the version fallback for 0.4.0+ servers", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.0",
      latestVersion: "0.4.29",
      updateAvailable: true,
      relayUsername: "dev-box",
      recommendedBaselineVersion: "0.4.0",
    });

    expect(
      notices.some((notice) => notice.id === "relay-resume-security"),
    ).toBe(false);
  });

  it("treats git-describe builds after 0.4.0 as past the security baseline", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.0-3-gabcdef",
      latestVersion: "0.4.29",
      updateAvailable: true,
      relayUsername: "dev-box",
      recommendedBaselineVersion: "0.4.0",
    });

    expect(
      notices.some((notice) => notice.id === "relay-resume-security"),
    ).toBe(false);
  });

  it("avoids unsafe old-version claims for unknown versions", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "dev",
      latestVersion: null,
      updateAvailable: false,
      relayUsername: "dev-box",
    });

    expect(notices).toEqual([]);
  });

  it("emits the release-specific recommended update notice", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.28",
      latestVersion: "0.4.29",
      updateAvailable: true,
      resumeProtocolVersion: 2,
      relayUsername: "dev-box",
      recommendedBaselineVersion: "0.4.29",
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      "backend-api-compat-0.4.29",
    ]);
    expect(notices[0]?.action?.command).toBe("npm update -g yepanywhere");
  });

  it("does not suggest npm update commands for source checkout versions", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.28-3-gabcdef",
      latestVersion: "0.4.29",
      updateAvailable: true,
      resumeProtocolVersion: 2,
      relayUsername: "dev-box",
      recommendedBaselineVersion: "0.4.29",
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      "backend-api-compat-0.4.29",
    ]);
    expect(notices[0]?.action).toBeUndefined();
  });

  it("uses a generic update notice when no specific notice applies", () => {
    const notices = getRemoteCompatibilityNotices({
      currentVersion: "0.4.29",
      latestVersion: "0.4.30",
      updateAvailable: true,
      resumeProtocolVersion: 2,
      relayUsername: "dev-box",
      recommendedBaselineVersion: "0.4.29",
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      "remote-update-available",
    ]);
  });
});

describe("remote compatibility semver helpers", () => {
  it("compares stable and prerelease versions", () => {
    expect(compareSemver("0.4.28", "0.4.29")).toBeLessThan(0);
    expect(compareSemver("v0.4.29", "0.4.29")).toBe(0);
    expect(compareSemver("0.4.29-rc.1", "0.4.29")).toBeLessThan(0);
    expect(compareSemver("dev", "0.4.29")).toBeNull();
  });

  it("parses git-describe source versions without marking them stable", () => {
    expect(parseSemver("0.4.28-3-gabcdef")).toMatchObject({
      normalized: "0.4.28-3-gabcdef",
      stable: false,
    });
    expect(compareSemver("0.4.28-3-gabcdef", "0.4.28")).toBeGreaterThan(0);
    expect(isVersionLessThan("0.4.28-3-gabcdef", "0.4.29")).toBe(true);
    expect(isVersionLessThan("0.4.0-3-gabcdef", "0.4.0")).toBe(false);
    expect(isStableReleaseVersion("0.4.28-3-gabcdef")).toBe(false);
    expect(isStableReleaseVersion("0.4.28")).toBe(true);
  });
});
