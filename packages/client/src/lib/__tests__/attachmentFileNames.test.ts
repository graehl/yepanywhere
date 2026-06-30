import { describe, expect, it } from "vitest";
import {
  makeAttachmentFileNamesUnique,
  uniqueAttachmentFileName,
} from "../attachmentFileNames";

describe("attachmentFileNames", () => {
  it("adds numeric suffixes before the extension for duplicate names", () => {
    const files = [
      new File(["a"], "image.png", { type: "image/png" }),
      new File(["b"], "image.png", { type: "image/png" }),
      new File(["c"], "image.png", { type: "image/png" }),
    ];

    expect(
      makeAttachmentFileNamesUnique(files).map((file) => file.name),
    ).toEqual(["image.png", "image-1.png", "image-2.png"]);
  });

  it("continues suffixes after existing attachment names", () => {
    expect(
      uniqueAttachmentFileName(
        "image.png",
        new Set(["image.png", "image-1.png"]),
      ),
    ).toBe("image-2.png");
  });

  it("leaves unique files unchanged", () => {
    const file = new File(["a"], "notes.txt", { type: "text/plain" });

    expect(makeAttachmentFileNamesUnique([file])[0]).toBe(file);
  });
});
