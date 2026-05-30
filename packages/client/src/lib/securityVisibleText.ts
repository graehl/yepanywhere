const SUSPICIOUS_UNICODE_NAMES: Record<number, string> = {
  1564: "ALM",
  6158: "MVS",
  8203: "ZWSP",
  8204: "ZWNJ",
  8205: "ZWJ",
  8206: "LRM",
  8207: "RLM",
  8234: "LRE",
  8235: "RLE",
  8236: "PDF",
  8237: "LRO",
  8238: "RLO",
  8288: "WJ",
  8289: "FA",
  8290: "IT",
  8291: "IS",
  8292: "IP",
  8294: "LRI",
  8295: "RLI",
  8296: "FSI",
  8297: "PDI",
  65279: "BOM",
};

function isSecuritySensitiveCodePoint(codePoint: number): boolean {
  if (codePoint <= 0x1f) {
    return codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d;
  }
  if (codePoint >= 0x7f && codePoint <= 0x9f) return true;
  if (codePoint >= 0x200b && codePoint <= 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2060 && codePoint <= 0x206f) return true;
  return codePoint === 0x061c || codePoint === 0x180e || codePoint === 0xfeff;
}

function describeCodePoint(codePoint: number): string {
  const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
  const name = SUSPICIOUS_UNICODE_NAMES[codePoint] ?? "CTRL";
  return `[U+${hex} ${name}]`;
}

export function makeSecurityVisibleText(text: string): string {
  let changed = false;
  const visible = Array.from(text, (char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || !isSecuritySensitiveCodePoint(codePoint)) {
      return char;
    }
    changed = true;
    return describeCodePoint(codePoint);
  }).join("");

  return changed ? visible : text;
}

export function makeSecurityVisibleValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") {
    return makeSecurityVisibleText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => makeSecurityVisibleValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      makeSecurityVisibleText(key),
      makeSecurityVisibleValue(entry, seen),
    ]),
  );
}
