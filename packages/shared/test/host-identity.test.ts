import { describe, expect, it } from "vitest";
import { normalizeHostIdentityIcon } from "../src/host-identity.js";

describe("normalizeHostIdentityIcon", () => {
  it.each(["💻", "🖥️", "❤️", "👨‍👩‍👧‍👦", "🇩🇪"])(
    "accepts one grapheme marker %s",
    (icon) => {
      expect(normalizeHostIdentityIcon(` ${icon} `)).toBe(icon);
    },
  );

  it.each(["", "   ", "💻❤️", "host"])(
    "rejects values that are not one marker %j",
    (icon) => {
      expect(normalizeHostIdentityIcon(icon)).toBeNull();
    },
  );
});
