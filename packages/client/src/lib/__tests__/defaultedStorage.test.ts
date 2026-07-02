import { describe, expect, it } from "vitest";
import {
  CLIENT_STORAGE_DEFAULT,
  normalizeDefaultedBooleanRecord,
  normalizeDefaultedEnumRecord,
  resolveDefaultedBooleanRecord,
  resolveDefaultedEnumRecord,
  resolveDefaultedValue,
  setDefaultedBooleanRecordValue,
} from "../defaultedStorage";

const keys = ["first", "second"] as const;
type Priority = "pin" | "last" | "mid" | "first";

function isPriority(candidate: unknown): candidate is Priority {
  return (
    candidate === "pin" ||
    candidate === "last" ||
    candidate === "mid" ||
    candidate === "first"
  );
}

describe("defaultedStorage", () => {
  it("normalizes only explicit booleans and default markers", () => {
    expect(
      normalizeDefaultedBooleanRecord(
        {
          first: true,
          second: CLIENT_STORAGE_DEFAULT,
          unknown: false,
        },
        keys,
      ),
    ).toEqual({
      first: true,
      second: CLIENT_STORAGE_DEFAULT,
    });
  });

  it("resolves missing and defaulted values from current defaults", () => {
    expect(
      resolveDefaultedBooleanRecord(
        {
          first: false,
          second: CLIENT_STORAGE_DEFAULT,
        },
        { first: true, second: true },
        keys,
      ),
    ).toEqual({
      first: false,
      second: true,
    });
  });

  it("deletes a value when it is set back to default", () => {
    expect(
      setDefaultedBooleanRecordValue<(typeof keys)[number]>(
        { first: false, second: true },
        "first",
        CLIENT_STORAGE_DEFAULT,
      ),
    ).toEqual({ second: true });
  });

  it("resolves scalar default markers from the provided default", () => {
    expect(resolveDefaultedValue(CLIENT_STORAGE_DEFAULT, "server-choice")).toBe(
      "server-choice",
    );
    expect(resolveDefaultedValue("explicit-choice", "server-choice")).toBe(
      "explicit-choice",
    );
  });

  it("normalizes only valid enum values and default markers", () => {
    expect(
      normalizeDefaultedEnumRecord(
        {
          first: "mid",
          second: CLIENT_STORAGE_DEFAULT,
          unknown: "pin",
        },
        keys,
        isPriority,
      ),
    ).toEqual({
      first: "mid",
      second: CLIENT_STORAGE_DEFAULT,
    });

    expect(
      normalizeDefaultedEnumRecord(
        {
          first: "invalid",
          second: 1,
        },
        keys,
        isPriority,
      ),
    ).toEqual({});
  });

  it("resolves enum default markers from current defaults", () => {
    expect(
      resolveDefaultedEnumRecord(
        {
          first: "first",
          second: CLIENT_STORAGE_DEFAULT,
        },
        { first: "pin", second: "last" },
        keys,
      ),
    ).toEqual({
      first: "first",
      second: "last",
    });
  });
});
