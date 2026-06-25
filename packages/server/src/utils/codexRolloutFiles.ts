export function isCodexRolloutFileName(name: string): boolean {
  return name.endsWith(".jsonl") || name.endsWith(".jsonl.zst");
}

export function isCompressedCodexRolloutPath(filePath: string): boolean {
  return filePath.endsWith(".jsonl.zst");
}

export function plainCodexRolloutPath(filePath: string): string {
  return isCompressedCodexRolloutPath(filePath)
    ? filePath.slice(0, -".zst".length)
    : filePath;
}

export function preferPlainCodexRollouts(filePaths: string[]): string[] {
  const plainPaths = new Set(
    filePaths
      .filter((filePath) => filePath.endsWith(".jsonl"))
      .map((filePath) => filePath),
  );

  return filePaths.filter((filePath) => {
    if (!isCompressedCodexRolloutPath(filePath)) return true;
    return !plainPaths.has(plainCodexRolloutPath(filePath));
  });
}
