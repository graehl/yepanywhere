function splitFilenameExtension(name: string): {
  stem: string;
  extension: string;
} {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) {
    return { stem: name, extension: "" };
  }
  return {
    stem: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  };
}

export function uniqueAttachmentFileName(
  originalName: string,
  usedNames: ReadonlySet<string>,
): string {
  if (!usedNames.has(originalName)) {
    return originalName;
  }

  const { stem, extension } = splitFilenameExtension(originalName);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
}

export function makeAttachmentFileNamesUnique(
  files: readonly File[],
  existingNames: Iterable<string> = [],
): File[] {
  const usedNames = new Set(existingNames);
  return files.map((file) => {
    const uniqueName = uniqueAttachmentFileName(file.name, usedNames);
    usedNames.add(uniqueName);
    if (uniqueName === file.name) {
      return file;
    }
    return new File([file], uniqueName, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}
