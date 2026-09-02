import type { CodexSessionEntry } from "@yep-anywhere/shared";
import { parseCodexSessionEntry } from "@yep-anywhere/shared";
import {
  getCodexRolloutActivityTimeMs,
  isCompressedCodexRolloutPath,
} from "../utils/codexRolloutFiles.js";
import {
  parseCodexSourceByteCursor,
  tagCodexEntrySourceByteOffset,
} from "./normalization.js";

const READ_CHUNK_BYTES = 1024 * 1024;
const ESTIMATED_BYTES_PER_COMPACT_BOUNDARY = 2 * 1024 * 1024;

export interface CodexRolloutStats {
  size: number | bigint;
  mtimeMs: number | bigint;
  ctimeMs: number | bigint;
}

export interface CodexParsedEntrySnapshot {
  entries: CodexSessionEntry[];
  partialLine: Buffer;
  readLinesMs: number;
  parseMs: number;
  lineCount: number;
  maxLineLength: number;
}

interface CodexEntrySnapshot {
  entries: CodexSessionEntry[];
  transcriptSnapshotUpdatedAt: string;
}

export interface CodexCompactTailSnapshot extends CodexEntrySnapshot {
  kind: "compact-tail";
  omittedPrefix: true;
  startByte: number;
  compactBoundaries: number;
}

export interface CodexCompactPageSnapshot extends CodexEntrySnapshot {
  kind: "compact-page";
  omittedPrefix: boolean;
  startByte: number;
  endByte: number;
  compactBoundaries: number;
}

export type CodexCompactWindowSnapshot =
  | CodexCompactTailSnapshot
  | CodexCompactPageSnapshot;

export type ReadExactCodexRolloutRange = (
  filePath: string,
  start: number,
  length: number,
) => Promise<Buffer>;

export class CodexRolloutWindowReader {
  constructor(private readonly readExactRange: ReadExactCodexRolloutRange) {}

  async readEntryRange(
    filePath: string,
    start: number,
    length: number,
    readStartedAt = Date.now(),
    initialPartialLine: Buffer = Buffer.alloc(0),
  ): Promise<CodexParsedEntrySnapshot> {
    const entries: CodexSessionEntry[] = [];
    let partialLineChunks =
      initialPartialLine.length > 0 ? [initialPartialLine] : [];
    let partialLineBytes = initialPartialLine.length;
    let partialLineStart = start - initialPartialLine.length;
    let lineCount = 0;
    let maxLineLength = 0;
    let parseMs = 0;

    const parseLine = (lineBytes: Buffer, sourceByteOffset: number): void => {
      const parseStartedAt = Date.now();
      const line = lineBytes.toString("utf8");
      lineCount += 1;
      maxLineLength = Math.max(maxLineLength, line.length);
      const trimmed = line.trim();
      if (trimmed) {
        const entry = parseCodexSessionEntry(trimmed);
        if (entry) {
          entries.push(tagCodexEntrySourceByteOffset(entry, sourceByteOffset));
        }
      }
      parseMs += Date.now() - parseStartedAt;
    };

    let totalBytesRead = 0;
    while (totalBytesRead < length) {
      const bytesToRead = Math.min(READ_CHUNK_BYTES, length - totalBytesRead);
      const buffer = await this.readExactRange(
        filePath,
        start + totalBytesRead,
        bytesToRead,
      );
      totalBytesRead += buffer.length;

      let segmentStart = 0;
      for (;;) {
        const newline = buffer.indexOf(0x0a, segmentStart);
        if (newline < 0) break;

        const segment = buffer.subarray(segmentStart, newline);
        const lineBytes =
          partialLineChunks.length === 0
            ? segment
            : Buffer.concat(
                [...partialLineChunks, segment],
                partialLineBytes + segment.length,
              );
        parseLine(lineBytes, partialLineStart);
        partialLineStart += partialLineBytes + segment.length + 1;
        partialLineChunks = [];
        partialLineBytes = 0;
        segmentStart = newline + 1;
      }

      if (segmentStart < buffer.length) {
        const segment = Buffer.from(buffer.subarray(segmentStart));
        partialLineChunks.push(segment);
        partialLineBytes += segment.length;
      }
    }

    let partialLine =
      partialLineChunks.length === 0
        ? Buffer.alloc(0)
        : Buffer.concat(partialLineChunks, partialLineBytes);
    if (partialLine.length > 0) {
      const entryCountBeforeFinalLine = entries.length;
      parseLine(partialLine, partialLineStart);
      if (entries.length > entryCountBeforeFinalLine) {
        partialLine = Buffer.alloc(0);
      }
    }

    return {
      entries,
      partialLine,
      readLinesMs: Math.max(0, Date.now() - readStartedAt - parseMs),
      parseMs,
      lineCount,
      maxLineLength,
    };
  }

  async readCompactTailSnapshot(
    filePath: string,
    stats: CodexRolloutStats,
    compactBoundaries: number,
  ): Promise<CodexCompactTailSnapshot | null> {
    const fileSize = Number(stats.size);
    if (
      isCompressedCodexRolloutPath(filePath) ||
      fileSize <= ESTIMATED_BYTES_PER_COMPACT_BOUNDARY * compactBoundaries
    ) {
      return null;
    }

    const startByte = await this.findCompactWindowStart(
      filePath,
      fileSize,
      compactBoundaries,
    );
    if (startByte === null || startByte <= 0) {
      return null;
    }

    const parsed = await this.readEntryRange(
      filePath,
      startByte,
      fileSize - startByte,
    );
    if (parsed.entries[0]?.type !== "compacted") {
      return null;
    }

    return {
      entries: parsed.entries,
      transcriptSnapshotUpdatedAt: new Date(
        getCodexRolloutActivityTimeMs(filePath, stats),
      ).toISOString(),
      kind: "compact-tail",
      omittedPrefix: true,
      startByte,
      compactBoundaries,
    };
  }

  async readCompactPageSnapshot(
    filePath: string,
    stats: CodexRolloutStats,
    compactBoundaries: number,
    beforeMessageId: string,
  ): Promise<CodexCompactPageSnapshot | null> {
    const fileSize = Number(stats.size);
    const endByte = parseCodexSourceByteCursor(beforeMessageId);
    if (
      isCompressedCodexRolloutPath(filePath) ||
      endByte === null ||
      endByte <= 0 ||
      endByte > fileSize
    ) {
      return null;
    }

    const locatedStartByte = await this.findCompactWindowStart(
      filePath,
      endByte,
      compactBoundaries,
    );
    const startByte = locatedStartByte ?? 0;
    const parsed = await this.readEntryRange(
      filePath,
      startByte,
      endByte - startByte,
    );
    if (locatedStartByte !== null && parsed.entries[0]?.type !== "compacted") {
      return null;
    }

    return {
      entries: parsed.entries,
      transcriptSnapshotUpdatedAt: new Date(
        getCodexRolloutActivityTimeMs(filePath, stats),
      ).toISOString(),
      kind: "compact-page",
      omittedPrefix: startByte > 0,
      startByte,
      endByte,
      compactBoundaries,
    };
  }

  private async findCompactWindowStart(
    filePath: string,
    endByte: number,
    compactBoundaries: number,
  ): Promise<number | null> {
    let position = endByte;
    let rightPartial = Buffer.alloc(0);
    let found = 0;

    while (position > 0) {
      const start = Math.max(0, position - READ_CHUNK_BYTES);
      const block = await this.readExactRange(
        filePath,
        start,
        position - start,
      );
      const combined =
        rightPartial.length > 0 ? Buffer.concat([block, rightPartial]) : block;
      const firstNewline = combined.indexOf(0x0a);
      if (start > 0 && firstNewline < 0) {
        rightPartial = Buffer.from(combined);
        position = start;
        continue;
      }

      const completeStart = start === 0 ? 0 : firstNewline + 1;
      let lineEnd = combined.length;
      while (lineEnd > completeStart) {
        if (combined[lineEnd - 1] === 0x0a) {
          lineEnd -= 1;
          continue;
        }
        const previousNewline = combined.lastIndexOf(0x0a, lineEnd - 1);
        const lineStart = Math.max(completeStart, previousNewline + 1);
        const line = combined.subarray(lineStart, lineEnd);
        if (line.includes('"compacted"')) {
          try {
            const candidate = JSON.parse(line.toString("utf8")) as {
              type?: unknown;
            };
            if (candidate.type === "compacted") {
              found += 1;
              if (found === compactBoundaries) {
                return start + lineStart;
              }
            }
          } catch {
            // A provisional or malformed line is not a usable boundary.
          }
        }
        lineEnd = previousNewline >= completeStart ? previousNewline : 0;
      }

      rightPartial =
        start > 0
          ? Buffer.from(combined.subarray(0, firstNewline))
          : Buffer.alloc(0);
      position = start;
    }

    return null;
  }
}
