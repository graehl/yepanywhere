import {
  fromUrlProjectId,
  isUrlProjectId,
  PUBLIC_FILE_SHARES_CAPABILITY,
  serverHasCapability,
  type FileContentResponse,
  type GitFileDiffMode,
} from "@yep-anywhere/shared";
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { BackArrowIcon } from "./BackArrowIcon";
import {
  buildPublicShareFileHref,
  usePublicShareContext,
} from "../contexts/PublicShareContext";
import { useQuoteReply } from "../contexts/QuoteReplyContext";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useSessionViewerComment } from "../contexts/SessionViewerCommentContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useFileVersionControl } from "../hooks/useFileVersionControl";
import { usePublicShareStatus } from "../hooks/usePublicShareStatus";
import { useQuoteReplyButtonMode } from "../hooks/useQuoteReplyButtonMode";
import { useSelectionActions } from "../hooks/useMessageListSelectionQuote";
import { useRegisterQuoteableTextSource } from "../hooks/useQuoteableTextSource";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useSessionFileComments } from "../hooks/useSessionFileComments";
import { useVersion } from "../hooks/useVersion";
import { useViewerFind } from "../hooks/useViewerFind";
import { useI18n } from "../i18n";
import { toBrowserAppHref } from "../lib/appHref";
import {
  writeClipboardRichText,
  writeClipboardText,
  writeClipboardTextLater,
} from "../lib/clipboard";
import { getEmbeddedFileMediaBlob } from "../lib/embeddedFileMedia";
import { downloadBlob } from "../lib/imageActions";
import { isMarkdownLikeFile } from "../lib/markdownFiles";
import { extractMarkdownSnippetsFromSelection } from "../lib/markdownSelectionCopy";
import { getRenderedFileClipboardPayload } from "../lib/renderedFileClipboard";
import type { ViewerFindSource } from "../lib/viewerFind";
import { ArtifactPreview } from "./ArtifactPreview";
import { ViewerModeToggle } from "./ViewerModeToggle";
import {
  buildPublicSharePlayUrl,
  publicSharePlayUrlFromFileShareUrl,
} from "../lib/publicSharePlay";
import { SourceEditAction } from "./SourceEditor";
import { ViewerFindField } from "./ViewerFindField";
import { ViewerWindowActions } from "./ViewerWindowActions";
import {
  annotateShikiSourceOffsets,
  compactShikiLineBreaks,
  splitHighlightedSourceAfterLine,
} from "../lib/shikiHtml";
import {
  SESSION_FILE_COMMENT_MODE_ATTR,
  sessionFileCommentDraftKey,
  type SessionFileCommentDraft,
} from "../lib/sessionFileComments";
import {
  getAbsoluteFilePath,
  getProjectRelativePath,
  getPathBasename,
  isAbsoluteLikePath,
  makeDisplayPath,
  normalizePathSeparators,
  stripTrailingPathSeparators,
} from "../lib/text";
import { GitDiffBody } from "../pages/GitStatusDiffPreview";
import { ReviewCommentEditor } from "../pages/ReviewCommentWindow";
import {
  ReviewCommentInlineLayout,
  ReviewCommentSplitLayout,
} from "../pages/ReviewCommentSplitLayout";
import {
  fetchMediaBlob,
  LocalFileModal,
  LocalMediaModal,
  type LocalMediaSource,
  useLocalMediaInlinePreviews,
  useLocalResourceClick,
} from "./LocalMediaModal";
import {
  buildProjectFileViewUrl,
  FileDiffViewLinks,
  type FileViewSelection,
} from "./FileDiffViewLinks";
import { FileRevisionLink } from "./FileRevisionLink";
import { PublicFileShareModal } from "./PublicFileShareModal";
import {
  FilePathContextMenu,
  type FileViewPresentation,
  supportsSourceAndPreview,
  useStartNewSessionFromFile,
  useStartNewSessionWithPrefillAction,
} from "./FileResourceActions";
import { useImageResourceActions } from "./ImageResourceActions";
import viewerStyles from "./FileViewer.module.css";
import headerStyles from "./ViewerHeader.module.css";
import {
  combineDensityOffsets,
  FILE_MARKDOWN_PREVIEW_BASE_DENSITY,
  FILE_SOURCE_BASE_DENSITY,
  FileViewerDensityControls,
  getSourceViewStyle,
  MarkdownPreview,
  useFileViewerDensity,
} from "./MarkdownPreview";
import { FileViewerModal } from "./FilePathLink";
import { ViewerSelectAllButton } from "./ViewerSelectAllButton";
import { ParagraphQuoteRail } from "./ParagraphQuoteRail";
import { shouldStackFileViewerActions } from "./fileViewerHeaderLayout";
import {
  FileViewerEmbeddedMedia,
  getEmbeddedMediaKind,
} from "./FileViewerEmbeddedMedia";

export interface FileViewerSource {
  loadFile: (
    projectId: string,
    filePath: string,
    highlight: boolean,
    lineNumber?: number,
    lineEnd?: number,
    viewMode?: FileViewerMode,
  ) => Promise<FileContentResponse>;
  getRawFileUrl?: (
    projectId: string,
    filePath: string,
    download: boolean,
  ) => string | null;
  /** Current metadata without content, for the reload button's hover check. */
  statFile?: (
    projectId: string,
    filePath: string,
  ) => Promise<FileContentResponse>;
  fetchRawFileBlob?: (
    fileData: FileContentResponse,
    filePath: string,
    download: boolean,
  ) => Promise<Blob>;
  createMediaSource?: (
    fileData: FileContentResponse | null,
  ) => LocalMediaSource | undefined;
  transformRenderedMarkdownHtml?: (
    html: string,
    fileData: FileContentResponse,
  ) => string;
}

interface FileViewerProps {
  projectId: string;
  filePath: string;
  source?: FileViewerSource;
  openInNewTabUrl?: string | null;
  onClose?: () => void;
  /** Temporarily return the modal viewer to the session toolbar. */
  onMinimize?: () => void;
  /** Existing managed modal that owns nested media parking. */
  parentViewerId?: string;
  /** If true, renders as standalone page layout instead of modal content */
  standalone?: boolean;
  /** Line number to scroll to and highlight (1-indexed) */
  lineNumber?: number;
  /** End line for range highlighting (1-indexed). If not provided, only lineNumber is highlighted. */
  lineEnd?: number;
  /** Full shows context; range shows only the requested line range. */
  viewMode?: FileViewerMode;
  /** Requested initial representation; ordinary HTML remains source-first. */
  initialPresentation?: FileViewPresentation;
  /** Exact Git comparison selected for this file, when present. */
  diffMode?: GitFileDiffMode;
  /** Page-level controls hosted in the header's leading slot. */
  headerLeading?: ReactNode;
}

export type FileViewerMode = "full" | "range";

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u202fb`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}\u202fkb`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}\u202fmb`;
}

/**
 * Get language hint from file extension for potential future syntax highlighting.
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    php: "php",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    markdown: "markdown",
  };
  return langMap[ext] || "plaintext";
}

/**
 * Check if file is an image.
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** Lines the unhighlighted fallback renders; matches server highlighting. */
const PLAIN_RENDER_MAX_LINES = 10_000;

function isHtmlLikeFile(filePath: string, mimeType: string): boolean {
  return (
    /\.(?:html?|xhtml)$/i.test(filePath) ||
    mimeType === "text/html" ||
    mimeType === "application/xhtml+xml"
  );
}

function getProjectPath(projectId: string): string | null {
  if (!isUrlProjectId(projectId)) {
    return null;
  }
  try {
    return stripTrailingPathSeparators(fromUrlProjectId(projectId));
  } catch {
    return null;
  }
}

function getHighlightRange(
  lineNumber?: number,
  lineEnd?: number,
): { end: number; start: number } | null {
  if (lineNumber === undefined) {
    return null;
  }
  return {
    end: Math.max(lineNumber, lineEnd ?? lineNumber),
    start: lineNumber,
  };
}

function getContentStartLine(fileData: FileContentResponse | null): number {
  return fileData?.contentStartLine ?? 1;
}

function getContentEndLine(fileData: FileContentResponse): number | undefined {
  if (fileData.contentEndLine !== undefined) {
    return fileData.contentEndLine;
  }
  if (fileData.content === undefined) {
    return undefined;
  }
  return (
    getContentStartLine(fileData) + fileData.content.split("\n").length - 1
  );
}

function getContentWindowLabel(fileData: FileContentResponse): string | null {
  if (!fileData.contentTruncated) {
    return null;
  }
  const endLine = getContentEndLine(fileData);
  const total = fileData.contentTotalLines
    ? ` of ${fileData.contentTotalLines}`
    : "";
  return `Showing lines ${getContentStartLine(fileData)}-${endLine}${total}`;
}

function fileCommentLocation(
  filePath: string,
  lineStart?: number,
  lineEnd?: number,
): string {
  if (lineStart === undefined) return filePath;
  return `${filePath}:${lineStart}${lineEnd && lineEnd > lineStart ? `-${lineEnd}` : ""}`;
}

function sourceLineCommentAnchor(
  content: string,
  contentStartLine: number,
  filePath: string,
  lineNumber: number,
) {
  const lines = content.split("\n");
  const lineIndex = lineNumber - contentStartLine;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const snippetStart = Math.max(0, lineIndex - 3);
  const snippetEnd = Math.min(lines.length, lineIndex + 4);
  return {
    location: fileCommentLocation(filePath, lineNumber),
    quote: lines.slice(snippetStart, snippetEnd).join("\n"),
    afterLine: lineNumber,
  };
}

function markdownSelectionAfterBlock(
  preview: HTMLElement,
  range: Range,
): number | undefined {
  const blocks = Array.from(
    preview.querySelectorAll<HTMLElement>(
      ".markdown-rendered > :not([data-review-comment-inline-host])",
    ),
  );
  let lastIntersecting: number | undefined;
  for (let index = 0; index < blocks.length; index += 1) {
    try {
      if (range.intersectsNode(blocks[index]!)) lastIntersecting = index;
    } catch {
      // A detached range is no longer a usable placement anchor.
    }
  }
  return lastIntersecting;
}

function MarkdownInlineCommentHost({
  afterBlock,
  children,
  editor,
  previewRef,
}: {
  afterBlock: number | undefined;
  children: ReactNode;
  editor: ReactNode | null;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (afterBlock === undefined) {
      setPortalTarget(null);
      return;
    }
    const preview = previewRef.current;
    if (!preview) {
      setPortalTarget(null);
      return;
    }
    const host = preview.ownerDocument.createElement("div");
    host.dataset.reviewCommentInlineHost = "";
    const mount = () => {
      const blocks = preview.querySelectorAll<HTMLElement>(
        ".markdown-rendered > :not([data-review-comment-inline-host])",
      );
      const block = blocks.item(afterBlock);
      if (block && block.nextElementSibling !== host) block.after(host);
    };
    mount();
    if (!host.isConnected) {
      setPortalTarget(null);
      return;
    }
    const observer = new MutationObserver(mount);
    observer.observe(preview, { childList: true, subtree: true });
    setPortalTarget(host);
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [afterBlock, previewRef]);

  return (
    <div ref={previewRef}>
      {children}
      {portalTarget
        ? createPortal(
            <ReviewCommentInlineLayout editor={editor} />,
            portalTarget,
            "session-file-comment-editor",
          )
        : null}
    </div>
  );
}

function SessionFileCommentEditor({
  busy,
  cancelLabel,
  draft,
  error,
  onCancel,
  onChange,
  onPersist,
  onSend,
  placeholder,
  sendLabel,
}: {
  busy: boolean;
  cancelLabel: string;
  draft: SessionFileCommentDraft;
  error: string | null;
  onCancel: (id: string) => void;
  onChange: (id: string, text: string) => void;
  onPersist: () => void;
  onSend: (id: string) => void;
  placeholder: string;
  sendLabel: string;
}) {
  const [text, setText] = useState(draft.text);
  return (
    <ReviewCommentEditor
      anchorLabel={draft.location}
      snippet={draft.quote}
      text={text}
      placeholder={placeholder}
      autoFocus={!draft.preserveSelection}
      error={error}
      onBlur={onPersist}
      onChange={(nextText) => {
        setText(nextText);
        onChange(draft.id, nextText);
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSend(draft.id);
      }}
      actions={
        <>
          <button
            type="button"
            onClick={() => onCancel(draft.id)}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={viewerStyles.commentSend}
            onClick={() => onSend(draft.id)}
            disabled={!text.trim() || busy}
          >
            {sendLabel}
          </button>
        </>
      }
    />
  );
}

function annotateHighlightedHtmlLines(
  html: string | undefined,
  contentStartLine: number,
  lineNumber?: number,
  lineEnd?: number,
): string | undefined {
  if (!html) {
    return html;
  }
  const range = getHighlightRange(lineNumber, lineEnd);
  const singleLine = range?.start === range?.end;
  let currentLine = 0;
  return html.replace(/<span class="([^"]*)">/g, (match, className: string) => {
    if (!className.split(/\s+/).includes("line")) {
      return match;
    }
    currentLine += 1;
    const actualLine = contentStartLine + currentLine - 1;
    const inRange =
      range !== null && actualLine >= range.start && actualLine <= range.end;
    const classes = [
      className,
      singleLine && inRange ? "highlighted-line" : "",
      actualLine === range?.start ? "highlighted-line-start" : "",
      actualLine === range?.end ? "highlighted-line-end" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<span class="${classes}" data-line="${actualLine}">`;
  });
}

const DEFAULT_FILE_VIEWER_SOURCE: FileViewerSource = {
  loadFile: (projectId, filePath, highlight, lineNumber, lineEnd, viewMode) =>
    api.getFile(projectId, filePath, highlight, lineNumber, lineEnd, viewMode),
  getRawFileUrl: (projectId, filePath, download) =>
    api.getFileRawUrl(projectId, filePath, download),
  statFile: (projectId, filePath) => api.getFileMetadata(projectId, filePath),
  // Fetch raw bytes through the active source transport so images and downloads
  // work when same-origin /api URLs cannot address the source.
  fetchRawFileBlob: (fileData, _filePath, download) => {
    const { rawUrl } = fileData;
    if (!rawUrl) {
      throw new Error("Raw file URL unavailable");
    }
    const apiPath = download
      ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}download=true`
      : rawUrl;
    return fetchMediaBlob(apiPath);
  },
  createMediaSource: (fileData) =>
    fileData
      ? {
          fetchBlob: async (_path, apiPath) => {
            const embedded = getEmbeddedFileMediaBlob(fileData, _path);
            return embedded ?? fetchMediaBlob(apiPath);
          },
        }
      : undefined,
};

function getTargetTopWithinContainer(
  container: HTMLElement,
  target: HTMLElement,
): number {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return targetRect.top - containerRect.top + container.scrollTop;
}

function getFileViewerTargetScrollTop(
  container: HTMLElement,
  target: HTMLElement,
): number {
  if (container.scrollHeight <= container.clientHeight) {
    return 0;
  }
  const targetTop = getTargetTopWithinContainer(container, target);
  const leadIn = container.clientHeight * 0.1;
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );
  return Math.max(0, Math.min(maxScrollTop, targetTop - leadIn));
}

/**
 * FileViewer component - displays file content with appropriate formatting.
 */
export const FileViewer = memo(function FileViewer({
  projectId,
  filePath,
  source = DEFAULT_FILE_VIEWER_SOURCE,
  openInNewTabUrl,
  onClose,
  onMinimize,
  parentViewerId,
  standalone = false,
  lineNumber,
  lineEnd,
  viewMode = "full",
  initialPresentation,
  diffMode,
  headerLeading,
}: FileViewerProps) {
  const { t } = useI18n();
  const quoteTextBlock = useQuoteReply();
  const sendSessionViewerComment = useSessionViewerComment();
  const sessionMetadata = useOptionalSessionMetadata();
  const { quoteReplyButtonMode } = useQuoteReplyButtonMode();
  const sourceRuntime = useCurrentSourceRuntime();
  const transport = sourceRuntime.transport;
  const publicShareContext = usePublicShareContext();
  const viewIdentity = `${projectId}\0${filePath}\0${diffMode ?? "source"}`;
  const [showPreview, setShowPreview] = useState(false);
  const [modeControlsHost, setModeControlsHost] =
    useState<HTMLSpanElement | null>(null);
  const [interactivePreviewIdentity, setInteractivePreviewIdentity] = useState<
    string | null
  >(null);
  const explicitSourceIdentityRef = useRef<string | null>(null);
  const [storedView, setStoredView] = useState<{
    identity: string;
    view: FileViewSelection;
  }>(() => ({ identity: viewIdentity, view: diffMode ?? "source" }));
  const activeView =
    storedView.identity === viewIdentity
      ? storedView.view
      : (diffMode ?? "source");
  const selectView = useCallback(
    (view: FileViewSelection) => {
      if (view === "source") {
        explicitSourceIdentityRef.current = viewIdentity;
        setShowPreview(false);
        setInteractivePreviewIdentity(null);
      }
      setStoredView({ identity: viewIdentity, view });
    },
    [viewIdentity],
  );
  const diffActive = activeView !== "source";
  const effectiveLineNumber = diffActive ? undefined : lineNumber;
  const effectiveLineEnd = diffActive ? undefined : lineEnd;
  const effectiveViewMode = diffActive ? "full" : viewMode;
  const fileVersionControl = useFileVersionControl(
    publicShareContext === null ? projectId : undefined,
    filePath,
  );
  const activeDiffFile =
    activeView === "worktree"
      ? fileVersionControl.worktreeFile
      : activeView === "cumulative"
        ? fileVersionControl.cumulativeFile
        : null;
  const sameOriginUrls = transport.capabilities.sameOriginUrls;
  const basePath = useRemoteBasePath();
  const publicSharePlayHref =
    publicShareContext && publicShareContext.projectId !== null
      ? buildPublicSharePlayUrl(basePath, {
          relayUsername: publicShareContext.relayUsername,
          relayUrl: publicShareContext.relayUrl,
          secret: publicShareContext.secret,
          projectId: publicShareContext.projectId,
          path: filePath,
        })
      : null;
  const [fileData, setFileData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // A state-backed ref: the header mounts only after loading, so a one-shot
  // effect over a plain ref would find nothing and never measure it.
  const [fileHeaderElement, setFileHeaderElement] =
    useState<HTMLDivElement | null>(null);
  const fileHeaderContextRef = useRef<HTMLDivElement>(null);
  const fileHeaderProvenanceRef = useRef<HTMLDivElement>(null);
  const fileHeaderActionsRef = useRef<HTMLDivElement>(null);
  const [stackHeaderActions, setStackHeaderActions] = useState(false);
  const [fileShareAnchor, setFileShareAnchor] = useState<DOMRect | null>(null);
  const loadedSourceRef = useRef<{
    identity: string;
    source: FileViewerSource;
  } | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [rawObjectUrl, setRawObjectUrl] = useState<string | null>(null);
  const [highlightedLineRef, setHighlightedLineRef] =
    useState<HTMLElement | null>(null);
  const viewerDensity = useFileViewerDensity();
  const sourceDensity = combineDensityOffsets(
    FILE_SOURCE_BASE_DENSITY,
    viewerDensity.density,
  );
  const markdownDensity = combineDensityOffsets(
    FILE_MARKDOWN_PREVIEW_BASE_DENSITY,
    viewerDensity.density,
  );
  const sourceStyle = getSourceViewStyle(sourceDensity);
  const projectPath = useMemo(() => getProjectPath(projectId), [projectId]);
  const projectRelativeCopyPath = useMemo(() => {
    if (!isAbsoluteLikePath(filePath)) {
      return normalizePathSeparators(filePath).replace(/^\.\/+/, "");
    }
    return getProjectRelativePath(filePath, projectPath);
  }, [filePath, projectPath]);
  const viewerCommentPath = projectRelativeCopyPath ?? filePath;
  const quoteableSourceContext = useMemo(
    () => ({
      projectId,
      filePath: viewerCommentPath,
      contentStartLine: fileData ? getContentStartLine(fileData) : 1,
    }),
    [fileData, projectId, viewerCommentPath],
  );
  const commentStorageKey = useMemo(
    () =>
      sessionMetadata && sendSessionViewerComment
        ? sessionFileCommentDraftKey({
            sourceKey: sourceRuntime.sourceKey,
            sessionId: sessionMetadata.sessionId,
            projectId,
            filePath,
          })
        : null,
    [
      filePath,
      projectId,
      sendSessionViewerComment,
      sessionMetadata,
      sourceRuntime.sourceKey,
    ],
  );
  const sessionFileComments = useSessionFileComments({
    active: commentMode,
    storageKey: commentStorageKey,
    sendComment: sendSessionViewerComment,
  });
  const fileViewerBodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = fileHeaderElement;
    const context = fileHeaderContextRef.current;
    const provenance = fileHeaderProvenanceRef.current;
    const actions = fileHeaderActionsRef.current;
    if (!header || !context || !provenance || !actions) return;

    const measure = () => {
      const headerStyle = getComputedStyle(header);
      const actionsStyle = getComputedStyle(actions);
      const horizontalPadding =
        Number.parseFloat(headerStyle.paddingLeft) +
        Number.parseFloat(headerStyle.paddingRight);
      const actionWidths = Array.from(
        actions.children,
        (child) => child.getBoundingClientRect().width,
      ).filter((width) => width > 0);
      const next = shouldStackFileViewerActions({
        actionGap: Number.parseFloat(actionsStyle.columnGap) || 0,
        actionWidths,
        availableWidth: header.clientWidth - horizontalPadding,
        contextWidth: context.getBoundingClientRect().width,
        headerGap: Number.parseFloat(headerStyle.columnGap) || 0,
        provenanceWidth: provenance.getBoundingClientRect().width,
      });
      setStackHeaderActions((current) => (current === next ? current : next));
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    const observeActionChildren = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(header);
      resizeObserver?.observe(context);
      resizeObserver?.observe(provenance);
      resizeObserver?.observe(actions);
      for (const child of actions.children) resizeObserver?.observe(child);
    };
    const mutationObserver = new MutationObserver(() => {
      observeActionChildren();
      measure();
    });
    mutationObserver.observe(actions, { childList: true, subtree: true });
    observeActionChildren();
    measure();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [fileHeaderElement]);
  useRegisterQuoteableTextSource(
    fileViewerBodyRef,
    diffActive ? undefined : fileData?.content,
    quoteableSourceContext,
  );
  const startNewSessionWithPrefill = useStartNewSessionWithPrefillAction();
  const startNewSessionFromSelection = useCallback(
    (prefill: string) => {
      startNewSessionWithPrefill(projectId, prefill);
    },
    [projectId, startNewSessionWithPrefill],
  );
  const markdownPreviewRef = useRef<HTMLDivElement>(null);
  const {
    modal: localMediaModal,
    localFileModal,
    projectFileModal,
    handleClick: handleLocalResourceClick,
    handleContextMenu: handleLocalResourceContextMenu,
    closeModal: closeLocalMediaModal,
    closeLocalFileModal,
    closeProjectFileModal,
    contextMenuElement: localResourceContextMenu,
  } = useLocalResourceClick({
    projectContext: { projectId, projectPath },
  });
  const localResourceClickRef = useRef(handleLocalResourceClick);
  const localResourceContextMenuRef = useRef(handleLocalResourceContextMenu);
  localResourceClickRef.current = handleLocalResourceClick;
  localResourceContextMenuRef.current = handleLocalResourceContextMenu;
  const handleMarkdownLocalResourceClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) =>
      localResourceClickRef.current(event),
    [],
  );
  const handleMarkdownLocalResourceContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) =>
      localResourceContextMenuRef.current(event),
    [],
  );
  const handleLocalResourceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== " ") return;
      const target = (event.target as HTMLElement).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!target) return;

      event.preventDefault();
      target.click();
    },
    [],
  );
  const handleViewerBodyPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        event.button > 0 ||
        (event.target instanceof Element &&
          event.target.closest(
            "button, input, textarea, select, a[href], [contenteditable='true']",
          ))
      ) {
        return;
      }
      event.currentTarget.focus({ preventScroll: true });
    },
    [],
  );
  const handleViewerBodyMouseDownCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest(
            "button, input, textarea, select, a[href], [contenteditable='true']",
          ))
      ) {
        return;
      }
      const selection = event.currentTarget.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }
      const selectionBelongsToViewer =
        (selection.anchorNode !== null &&
          event.currentTarget.contains(selection.anchorNode)) ||
        (selection.focusNode !== null &&
          event.currentTarget.contains(selection.focusNode));
      if (selectionBelongsToViewer) selection.removeAllRanges();
    },
    [],
  );
  const commentModeSupported = Boolean(
    sendSessionViewerComment &&
      sessionMetadata &&
      onClose &&
      !standalone &&
      publicShareContext === null &&
      !diffActive &&
      fileData?.metadata.isText &&
      fileData.content !== undefined &&
      !(showPreview && isHtmlLikeFile(filePath, fileData.metadata.mimeType)),
  );
  useEffect(() => {
    if (!commentMode || commentModeSupported) return;
    void sessionFileComments.flush();
    setCommentMode(false);
  }, [commentMode, commentModeSupported, sessionFileComments.flush]);

  const openSelectionComment = useCallback(() => {
    const body = fileViewerBodyRef.current;
    if (!commentMode || !commentModeSupported || !body) return;
    const snippets = extractMarkdownSnippetsFromSelection(body);
    if (snippets.length === 0) return;
    const sourceLocations = snippets
      .map((snippet) => snippet.sourceLocation)
      .filter((location) => location?.filePath === viewerCommentPath);
    const lineStart =
      sourceLocations.length === snippets.length
        ? Math.min(
            ...sourceLocations.map((location) => location?.lineStart ?? 1),
          )
        : undefined;
    const lineEnd =
      sourceLocations.length === snippets.length
        ? Math.max(...sourceLocations.map((location) => location?.lineEnd ?? 1))
        : undefined;
    const afterBlock = showPreview
      ? markdownSelectionAfterBlock(
          markdownPreviewRef.current ?? body,
          snippets.at(-1)!.range,
        )
      : undefined;
    sessionFileComments.open({
      location: fileCommentLocation(viewerCommentPath, lineStart, lineEnd),
      quote: snippets.map((snippet) => snippet.markdown).join("\n\n"),
      preserveSelection: true,
      ...(!showPreview && lineEnd !== undefined ? { afterLine: lineEnd } : {}),
      ...(afterBlock === undefined ? {} : { afterBlock }),
    });
  }, [
    commentMode,
    commentModeSupported,
    sessionFileComments.open,
    showPreview,
    viewerCommentPath,
  ]);

  useEffect(() => {
    if (!commentMode || !commentModeSupported) return;
    const body = fileViewerBodyRef.current;
    const doc = body?.ownerDocument;
    if (!body || !doc) return;
    let pointerSelecting = false;
    let scheduled = 0;
    const scheduleOpen = () => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(openSelectionComment, 0);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.button === 0 &&
        event.target instanceof Node &&
        body.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest("button, input, textarea, select, a[href]")
        )
      ) {
        pointerSelecting = true;
      }
    };
    const handlePointerUp = () => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      scheduleOpen();
    };
    const handleSelectionChange = () => {
      const activeElement = doc.activeElement;
      if (
        activeElement instanceof Element &&
        activeElement.closest('[data-markdown-copy-ignore="true"]')
      ) {
        return;
      }
      if (!pointerSelecting) scheduleOpen();
    };
    doc.addEventListener("pointerdown", handlePointerDown, true);
    doc.addEventListener("pointerup", handlePointerUp, true);
    doc.addEventListener("pointercancel", handlePointerUp, true);
    doc.addEventListener("selectionchange", handleSelectionChange);
    scheduleOpen();
    return () => {
      window.clearTimeout(scheduled);
      doc.removeEventListener("pointerdown", handlePointerDown, true);
      doc.removeEventListener("pointerup", handlePointerUp, true);
      doc.removeEventListener("pointercancel", handlePointerUp, true);
      doc.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [commentMode, commentModeSupported, openSelectionComment]);

  const handleViewerBodyClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!commentMode || !commentModeSupported || !fileData?.content) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, select, a[href], [contenteditable='true']",
        )
      ) {
        return;
      }
      const selection = event.currentTarget.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed) return;
      const line =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-line]")
          : null;
      const lineNumber = Number(line?.dataset.line);
      if (!Number.isInteger(lineNumber)) return;
      const anchor = sourceLineCommentAnchor(
        fileData.content,
        getContentStartLine(fileData),
        viewerCommentPath,
        lineNumber,
      );
      if (anchor) sessionFileComments.open(anchor);
    },
    [
      commentMode,
      commentModeSupported,
      fileData,
      sessionFileComments.open,
      viewerCommentPath,
    ],
  );

  const handleCommentModeToggle = useCallback(() => {
    setCommentMode((current) => {
      if (current) void sessionFileComments.flush();
      return !current;
    });
  }, [sessionFileComments.flush]);
  const handleViewerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!commentMode) return;
      const next = event.relatedTarget;
      if (!(next instanceof Node)) {
        sessionFileComments.persist();
        return;
      }
      const viewerScope =
        event.currentTarget.closest("dialog") ?? event.currentTarget;
      if (!viewerScope.contains(next)) void sessionFileComments.flush();
    },
    [commentMode, sessionFileComments.flush, sessionFileComments.persist],
  );
  const handleClose = useCallback(() => {
    void sessionFileComments.flush();
    onClose?.();
  }, [onClose, sessionFileComments.flush]);
  const handleMinimize = useCallback(() => {
    void sessionFileComments.flush();
    onMinimize?.();
  }, [onMinimize, sessionFileComments.flush]);
  const mediaSource = useMemo(
    () => source.createMediaSource?.(fileData),
    [fileData, source],
  );
  const renderedMarkdownHtml = useMemo(() => {
    if (!fileData?.renderedMarkdownHtml) {
      return null;
    }
    return source.transformRenderedMarkdownHtml
      ? source.transformRenderedMarkdownHtml(
          fileData.renderedMarkdownHtml,
          fileData,
        )
      : fileData.renderedMarkdownHtml;
  }, [fileData, source]);
  const renderedMarkdownPreview = useMemo(
    () =>
      renderedMarkdownHtml ? (
        <MarkdownPreview
          html={renderedMarkdownHtml}
          sourcePath={filePath}
          density={markdownDensity}
          ariaLabel={t("fileViewerPreview" as never)}
          onClick={handleMarkdownLocalResourceClick}
          onContextMenu={handleMarkdownLocalResourceContextMenu}
          onKeyDown={handleLocalResourceKeyDown}
        />
      ) : null,
    [
      filePath,
      handleLocalResourceKeyDown,
      handleMarkdownLocalResourceClick,
      handleMarkdownLocalResourceContextMenu,
      markdownDensity,
      renderedMarkdownHtml,
      t,
    ],
  );
  const renderedClipboardPayload = useMemo(
    () =>
      fileData
        ? getRenderedFileClipboardPayload(
            filePath,
            fileData,
            renderedMarkdownHtml ?? undefined,
          )
        : null,
    [fileData, filePath, renderedMarkdownHtml],
  );
  const highlightedHtml = useMemo(() => {
    const annotated = annotateHighlightedHtmlLines(
      fileData?.highlightedHtml,
      getContentStartLine(fileData),
      effectiveLineNumber,
      effectiveLineEnd,
    );
    return annotateShikiSourceOffsets(
      compactShikiLineBreaks(annotated),
      fileData?.content,
    );
  }, [effectiveLineEnd, effectiveLineNumber, fileData]);
  useLocalMediaInlinePreviews(
    markdownPreviewRef,
    !diffActive && showPreview ? renderedMarkdownHtml : null,
    mediaSource,
  );
  const highlightRenderKey =
    !diffActive && showPreview
      ? renderedMarkdownHtml
      : diffActive
        ? null
        : highlightedHtml;

  const sourceIdentity = `${projectId}\0${filePath}\0${lineNumber ?? ""}\0${lineEnd ?? ""}\0${viewMode}`;
  // The viewer deliberately does not watch the file; reloading is a reader's
  // explicit act. A running interactive frame remounts on the same grant so
  // its document is fetched again from disk.
  const [frameReloadKey, setFrameReloadKey] = useState(0);
  // Hovering the reload button probes the file's metadata and says whether
  // the loaded copy is behind the disk; absent times (older servers) say
  // nothing rather than guessing.
  const [freshness, setFreshness] = useState<
    { loadedAt: number; state: "fresh" } | { state: "stale"; at: number } | null
  >(null);
  const checkFreshness = useCallback(() => {
    const loaded = fileData?.metadata.modifiedAt;
    if (!source.statFile || loaded === undefined) return;
    void source
      .statFile(projectId, filePath)
      .then((current) => {
        const at = current.metadata.modifiedAt;
        if (at === undefined) return;
        setFreshness(
          at !== loaded || current.metadata.size !== fileData?.metadata.size
            ? { state: "stale", at }
            : { state: "fresh", loadedAt: loaded },
        );
      })
      .catch(() => setFreshness(null));
  }, [source, projectId, filePath, fileData]);
  const reloadFromDisk = useCallback(() => {
    setFreshness(null);
    setFrameReloadKey((value) => value + 1);
    void source
      .loadFile(
        projectId,
        filePath,
        true,
        effectiveLineNumber,
        effectiveLineEnd,
        effectiveViewMode,
      )
      .then(setFileData)
      .catch((error) => setError(String(error)));
  }, [
    source,
    projectId,
    filePath,
    effectiveLineNumber,
    effectiveLineEnd,
    effectiveViewMode,
  ]);

  useEffect(() => {
    if (activeView === "source" || fileVersionControl.loading) return;
    if (
      (activeView === "worktree" && !fileVersionControl.worktreeFile) ||
      (activeView === "cumulative" && !fileVersionControl.cumulativeFile)
    ) {
      selectView("source");
    }
  }, [activeView, fileVersionControl, selectView]);

  useEffect(() => {
    let cancelled = false;
    if (diffActive) {
      setLoading(false);
      setError(null);
      setHighlightedLineRef(null);
      return;
    }
    if (
      fileData &&
      loadedSourceRef.current?.identity === sourceIdentity &&
      loadedSourceRef.current.source === source
    ) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setHighlightedLineRef(null);

    // Request highlighting for code files
    source
      .loadFile(
        projectId,
        filePath,
        true,
        effectiveLineNumber,
        effectiveLineEnd,
        effectiveViewMode,
      )
      .then((data) => {
        if (!cancelled) {
          loadedSourceRef.current = { identity: sourceIdentity, source };
          setFileData(data);
          const markdownPreviewAvailable =
            isMarkdownLikeFile(filePath) && Boolean(data.renderedMarkdownHtml);
          const htmlPreviewAvailable =
            data.content !== undefined &&
            isHtmlLikeFile(filePath, data.metadata.mimeType);
          setShowPreview(
            explicitSourceIdentityRef.current === viewIdentity
              ? false
              : initialPresentation
                ? initialPresentation === "preview" &&
                  (markdownPreviewAvailable || htmlPreviewAvailable)
                : markdownPreviewAvailable || htmlPreviewAvailable,
          );
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || t("fileViewerLoadFailed" as never));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    diffActive,
    effectiveLineEnd,
    effectiveLineNumber,
    effectiveViewMode,
    filePath,
    initialPresentation,
    source,
    sourceIdentity,
    t,
    viewIdentity,
    fileData,
  ]);

  useEffect(() => {
    const mimeType = fileData?.metadata.mimeType;
    if (
      !fileData ||
      !mimeType ||
      !(isImageFile(mimeType) || getEmbeddedMediaKind(mimeType))
    ) {
      setRawObjectUrl(null);
      return;
    }
    if (
      !source.fetchRawFileBlob ||
      (getEmbeddedMediaKind(mimeType) === "pdf" && sameOriginUrls)
    ) {
      setRawObjectUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setRawObjectUrl(null);
    void source
      .fetchRawFileBlob(fileData, filePath, false)
      .then((blob) => {
        if (cancelled) return;
        // PDF and media players key off the blob's type, which a relayed
        // fetch may leave empty.
        objectUrl = URL.createObjectURL(
          blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }),
        );
        setRawObjectUrl(objectUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileData, filePath, sameOriginUrls, source]);

  // Handle Escape key to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  // Scroll to highlighted line when it's rendered
  useEffect(() => {
    if (effectiveLineNumber === undefined || !highlightRenderKey) {
      return;
    }
    const highlightedLine =
      highlightedLineRef ??
      fileViewerBodyRef.current?.querySelector<HTMLElement>(
        ".highlighted-line-start, .markdown-preview-span-start",
      );
    const viewerBody = fileViewerBodyRef.current;
    if (highlightedLine && viewerBody) {
      requestAnimationFrame(() => {
        viewerBody.scrollTop = getFileViewerTargetScrollTop(
          viewerBody,
          highlightedLine,
        );
      });
    }
  }, [effectiveLineNumber, highlightRenderKey, highlightedLineRef]);

  const handleCopy = useCallback(async () => {
    if (fileData?.content === undefined) return;
    try {
      const success = await writeClipboardText(fileData.content);
      if (!success) {
        throw new Error("Clipboard write failed");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [fileData?.content]);
  const handleCopyContentsFromMenu = useCallback(() => {
    void writeClipboardTextLater(
      source
        .loadFile(projectId, filePath, false)
        .then((file) => file.content ?? ""),
    );
  }, [filePath, projectId, source]);
  const handleCopyRenderedContentsFromMenu = useCallback(() => {
    if (!renderedClipboardPayload) return;
    void writeClipboardRichText(
      renderedClipboardPayload.html,
      renderedClipboardPayload.text,
    );
  }, [renderedClipboardPayload]);

  const displayPath = useMemo(
    () => makeDisplayPath(filePath, projectPath),
    [filePath, projectPath],
  );
  const absoluteCopyPath = useMemo(() => {
    return getAbsoluteFilePath(filePath, projectPath);
  }, [filePath, projectPath]);
  /**
   * A share viewer's own link, for callers that did not supply one.
   *
   * The authenticated `/projects/:id/file` URL is unusable to a share reader,
   * so a viewer opened from a share transcript anchor — which passes no
   * `openInNewTabUrl` — must name the share's route instead.
   */
  const shareViewerUrl = useMemo(() => {
    if (!publicShareContext) return null;
    return buildPublicShareFileHref(publicShareContext, {
      filePath,
      lineEnd,
      lineNumber,
      viewMode,
    });
  }, [filePath, lineEnd, lineNumber, publicShareContext, viewMode]);
  const sourceViewerUrl = useMemo(() => {
    if (openInNewTabUrl) return openInNewTabUrl;
    if (shareViewerUrl) return shareViewerUrl;
    return toBrowserAppHref(
      buildProjectFileViewUrl({
        basePath,
        filePath,
        lineEnd,
        lineNumber,
        projectId,
        viewMode,
      }),
    );
  }, [
    basePath,
    filePath,
    lineEnd,
    lineNumber,
    openInNewTabUrl,
    projectId,
    shareViewerUrl,
    viewMode,
  ]);
  const standaloneViewerUrl = useMemo(() => {
    if (activeView === "source" || shareViewerUrl) return sourceViewerUrl;
    return toBrowserAppHref(
      buildProjectFileViewUrl({
        basePath,
        diffMode: activeView,
        filePath: fileVersionControl.relativePath ?? filePath,
        projectId,
      }),
    );
  }, [
    activeView,
    basePath,
    filePath,
    fileVersionControl.relativePath,
    projectId,
    shareViewerUrl,
    sourceViewerUrl,
  ]);
  const fileName = getPathBasename(filePath);
  const language = getLanguageFromPath(filePath);
  const loadedIsImage = fileData
    ? isImageFile(fileData.metadata.mimeType)
    : false;
  // Split once per load: inline text may be up to 100 MB.
  const contentLines = useMemo(
    () => (fileData?.content ? fileData.content.split("\n") : []),
    [fileData?.content],
  );
  const rawFileUrl = fileData
    ? (source.getRawFileUrl?.(projectId, filePath, false) ?? fileData.rawUrl)
    : null;
  const imageOpenUrl = loadedIsImage
    ? sameOriginUrls && rawFileUrl
      ? rawFileUrl
      : (rawObjectUrl ?? (!source.fetchRawFileBlob ? rawFileUrl : null))
    : null;
  const openImageInNewTabLabel = t("fileViewerOpenImageNewTab" as never);
  const startNewSession = useStartNewSessionFromFile(projectId, filePath);

  const handleDownload = useCallback(() => {
    if (!fileData) return;
    if (source.fetchRawFileBlob) {
      void source
        .fetchRawFileBlob(fileData, filePath, true)
        .then((blob) => downloadBlob(blob, fileName))
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      return;
    }

    const params = new URLSearchParams({ path: filePath, download: "true" });
    void transport
      .fetchBlob(`/projects/${projectId}/files/raw?${params}`)
      .then((blob) => downloadBlob(blob, fileName))
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to download file",
        );
      });
  }, [fileData, fileName, filePath, projectId, source, transport]);

  const absoluteViewerLink = useMemo(
    () => new URL(standaloneViewerUrl, window.location.href).href,
    [standaloneViewerUrl],
  );

  const handleOpenInNewTab = useCallback(() => {
    if (imageOpenUrl) {
      window.open(imageOpenUrl, "_blank", "noopener");
      return;
    }
    window.open(standaloneViewerUrl, "_blank", "noopener");
  }, [imageOpenUrl, standaloneViewerUrl]);
  const loadImageBlob = useCallback(() => {
    if (!fileData) {
      return Promise.reject(new Error("Image is not loaded"));
    }
    if (source.fetchRawFileBlob) {
      return source.fetchRawFileBlob(fileData, filePath, false);
    }
    const params = new URLSearchParams({ path: filePath });
    return transport.fetchBlob(
      `/projects/${encodeURIComponent(projectId)}/files/raw?${params}`,
    );
  }, [fileData, filePath, projectId, source, transport]);
  const imageActions = useImageResourceActions({
    fileName,
    filePath,
    loadBlob: loadedIsImage ? loadImageBlob : undefined,
    onOpen: handleOpenInNewTab,
    projectPath,
    viewerLink: standaloneViewerUrl,
  });
  const handlePathContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Find searches what this view shows: the HTML preview's frame, else the
  // source, text, Markdown or diff rendered in the body.
  const [findBody, setFindBody] = useState<HTMLDivElement | null>(null);
  const [htmlFindSource, setHtmlFindSource] = useState<ViewerFindSource | null>(
    null,
  );
  const setBodyElement = useCallback((element: HTMLDivElement | null) => {
    fileViewerBodyRef.current = element;
    setFindBody(element);
  }, []);
  const showsHtmlPreview =
    !diffActive &&
    showPreview &&
    fileData?.content !== undefined &&
    fileData.metadata !== undefined &&
    isHtmlLikeFile(filePath, fileData.metadata.mimeType);
  const showsText = diffActive || fileData?.content !== undefined;
  const find = useViewerFind(
    useMemo(
      () =>
        showsHtmlPreview
          ? htmlFindSource
          : showsText && findBody
            ? ({ kind: "element", element: findBody } as const)
            : null,
      [showsHtmlPreview, htmlFindSource, showsText, findBody],
    ),
  );

  // Render loading state
  if (
    loading ||
    (!diffActive && !fileData && !error) ||
    (diffActive && fileVersionControl.loading && !activeDiffFile)
  ) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-loading">
          {t("fileViewerLoading" as never, { name: fileName })}
        </div>
      </div>
    );
  }

  // Render error state
  if (!diffActive && (error || !fileData)) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-error">
          {error || t("fileViewerNotFound" as never)}
        </div>
      </div>
    );
  }

  const metadata = fileData?.metadata;
  const content = fileData?.content;
  const isImage = loadedIsImage;
  const canDownload = Boolean(source.fetchRawFileBlob || rawFileUrl);
  const hasMarkdownPreview =
    content !== undefined &&
    isMarkdownLikeFile(filePath) &&
    !!renderedMarkdownHtml;
  const hasHtmlPreview =
    content !== undefined &&
    metadata !== undefined &&
    isHtmlLikeFile(filePath, metadata.mimeType);
  const hasFilePreview = hasMarkdownPreview || hasHtmlPreview;
  const activeCommentDraft = commentMode
    ? sessionFileComments.activeDraft
    : null;
  const activeCommentSending = activeCommentDraft
    ? sessionFileComments.sendingIds.has(activeCommentDraft.id)
    : false;
  const commentEditor = activeCommentDraft ? (
    <SessionFileCommentEditor
      key={activeCommentDraft.id}
      draft={activeCommentDraft}
      placeholder={t("fileViewerCommentPlaceholder" as never)}
      error={
        sessionFileComments.error
          ? t("fileViewerCommentSendFailed" as never)
          : null
      }
      busy={activeCommentSending}
      cancelLabel={t("cancel")}
      sendLabel={t("toolbarSend")}
      onCancel={sessionFileComments.cancel}
      onChange={sessionFileComments.update}
      onPersist={sessionFileComments.persist}
      onSend={(id) => void sessionFileComments.sendOne(id)}
    />
  ) : null;
  const splitCommentAfterLine =
    commentEditor && !showPreview ? activeCommentDraft?.afterLine : undefined;
  const splitCommentAfterBlock =
    commentEditor &&
    showPreview &&
    renderedMarkdownHtml &&
    activeCommentDraft?.afterBlock !== undefined
      ? activeCommentDraft.afterBlock
      : undefined;

  // Render content based on file type
  const renderContent = () => {
    if (diffActive) {
      return activeDiffFile ? (
        <div className={viewerStyles.diffBody}>
          <GitDiffBody
            file={activeDiffFile}
            fileKey={`file-viewer:${activeView}:${activeDiffFile.path}`}
            projectId={projectId}
            source={{ kind: "file-projection", mode: activeView }}
            captureReviewProjections
            t={t}
          />
        </div>
      ) : (
        <div className="file-viewer-loading">
          {t("fileViewerLoading" as never, { name: fileName })}
        </div>
      );
    }
    if (!fileData || !metadata) {
      return (
        <div className="file-viewer-error">
          {error || t("fileViewerNotFound" as never)}
        </div>
      );
    }

    // Image files
    if (isImage) {
      const imageUrl = source.fetchRawFileBlob ? rawObjectUrl : rawFileUrl;
      const imageLinkUrl = imageOpenUrl ?? imageUrl;
      return (
        <div className="file-viewer-image">
          {imageUrl && imageLinkUrl ? (
            <a
              className="file-viewer-image-link"
              href={imageLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={openImageInNewTabLabel}
              aria-label={openImageInNewTabLabel}
              onContextMenu={imageActions.handleContextMenu}
            >
              <img src={imageUrl} alt={fileName} />
            </a>
          ) : (
            <div className="file-viewer-loading">
              {t("fileViewerLoading" as never, { name: fileName })}
            </div>
          )}
        </div>
      );
    }

    const embeddedMediaKind = getEmbeddedMediaKind(metadata.mimeType);
    if (embeddedMediaKind) {
      // A blob document inherits this app's `object-src 'none'`, which makes
      // Chromium block its PDF viewer, so a directly addressable PDF frames
      // its own response instead.
      const mediaUrl =
        !source.fetchRawFileBlob ||
        (embeddedMediaKind === "pdf" && sameOriginUrls)
          ? rawFileUrl
          : rawObjectUrl;
      return mediaUrl ? (
        <FileViewerEmbeddedMedia
          kind={embeddedMediaKind}
          url={mediaUrl}
          fileName={fileName}
          sampleText={t("fileViewerFontSample" as never)}
          unsupported={binaryCard}
        />
      ) : (
        <div className="file-viewer-loading">
          {t("fileViewerLoading" as never, { name: fileName })}
        </div>
      );
    }

    // Text files
    if (content !== undefined) {
      // Show rendered markdown preview
      if (showPreview && hasMarkdownPreview && renderedMarkdownHtml) {
        return (
          <MarkdownInlineCommentHost
            afterBlock={commentEditor ? splitCommentAfterBlock : undefined}
            editor={commentEditor}
            previewRef={markdownPreviewRef}
          >
            {renderedMarkdownPreview}
          </MarkdownInlineCommentHost>
        );
      }

      if (showPreview && hasHtmlPreview) {
        return (
          <ArtifactPreview
            key={viewIdentity}
            html={content}
            path={filePath}
            projectId={projectId}
            className={viewerStyles.htmlPreviewFrame}
            title={fileName}
            autoStart={interactivePreviewIdentity === viewIdentity}
            toolbarHost={modeControlsHost}
            reloadKey={frameReloadKey}
            onFindSource={setHtmlFindSource}
          />
        );
      }

      // Server-rendered syntax highlighting (preferred)
      if (highlightedHtml) {
        const contentWindowLabel = getContentWindowLabel(fileData);
        const commentSplit =
          splitCommentAfterLine !== undefined
            ? splitHighlightedSourceAfterLine(
                highlightedHtml,
                splitCommentAfterLine,
              )
            : null;
        const highlightedPart = (html: string) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: delegation target for anchors in server-rendered HTML
          <div
            className="shiki-container"
            onClick={handleLocalResourceClick}
            onContextMenu={handleLocalResourceContextMenu}
            onKeyDown={handleLocalResourceKeyDown}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered HTML
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
        return (
          <div
            className="file-viewer-code file-viewer-code-highlighted"
            data-language={fileData.highlightedLanguage ?? language}
            style={sourceStyle}
          >
            {/* Source content carries project-path links too, so it needs the
                same interception the Markdown preview has — otherwise a path
                inside a JSON manifest would navigate away from the viewer
                instead of opening beside it. */}
            {commentSplit && commentEditor ? (
              <ReviewCommentSplitLayout
                before={highlightedPart(commentSplit.before)}
                editor={commentEditor}
                after={highlightedPart(commentSplit.after)}
              />
            ) : (
              highlightedPart(highlightedHtml)
            )}
            {fileData.highlightedTruncated && (
              <div className="file-viewer-truncated">
                {t("fileViewerHighlightTruncated" as never)}
              </div>
            )}
            {contentWindowLabel && (
              <div className="file-viewer-truncated">{contentWindowLabel}</div>
            )}
          </div>
        );
      }

      // Fallback: plain code (no syntax highlighting available). A large file
      // renders only its leading lines, as server highlighting does.
      const lines =
        contentLines.length > PLAIN_RENDER_MAX_LINES
          ? contentLines.slice(0, PLAIN_RENDER_MAX_LINES)
          : contentLines;
      const contentStartLine = getContentStartLine(fileData);
      const highlightStart = effectiveLineNumber ?? 0;
      const highlightEnd = Math.max(
        highlightStart,
        effectiveLineEnd ?? highlightStart,
      );
      const singleLineHighlight = highlightStart === highlightEnd;
      const contentWindowLabel = getContentWindowLabel(fileData);
      const renderPlainLines = (startIndex: number, endIndex: number) => {
        const visibleLines = lines.slice(startIndex, endIndex);
        return visibleLines.length > 0 ? (
          <div className="code-highlighter-plain">
            <div className="code-line-numbers">
              {visibleLines.map((_, index) => {
                const num = contentStartLine + startIndex + index;
                return <div key={`ln-${num}`}>{num}</div>;
              })}
            </div>
            <pre className="code-content">
              <code>
                {visibleLines.map((line, index) => {
                  const num = contentStartLine + startIndex + index;
                  const inRange =
                    effectiveLineNumber !== undefined &&
                    num >= highlightStart &&
                    num <= highlightEnd;
                  const classes = [
                    singleLineHighlight && inRange ? "highlighted-line" : "",
                    num === highlightStart ? "highlighted-line-start" : "",
                    num === highlightEnd ? "highlighted-line-end" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={`line-${num}`}
                      ref={
                        effectiveLineNumber !== undefined &&
                        num === highlightStart
                          ? (element) => setHighlightedLineRef(element)
                          : undefined
                      }
                      className={classes || undefined}
                      data-line={num}
                    >
                      {line || " "}
                    </div>
                  );
                })}
              </code>
            </pre>
          </div>
        ) : null;
      };
      const plainSplitIndex =
        splitCommentAfterLine === undefined
          ? null
          : Math.min(
              lines.length,
              Math.max(0, splitCommentAfterLine - contentStartLine + 1),
            );

      return (
        <div
          className="file-viewer-code"
          data-language={language}
          style={sourceStyle}
        >
          {plainSplitIndex !== null && commentEditor ? (
            <ReviewCommentSplitLayout
              before={renderPlainLines(0, plainSplitIndex)}
              editor={commentEditor}
              after={renderPlainLines(plainSplitIndex, lines.length)}
            />
          ) : lines.length > 0 ? (
            renderPlainLines(0, lines.length)
          ) : (
            <div className="file-viewer-empty-content">No content read</div>
          )}
          {lines.length < contentLines.length && (
            <div className="file-viewer-truncated">
              {t("fileViewerPlainTruncated" as never, {
                count: lines.length,
                total: contentLines.length,
              })}
            </div>
          )}
          {contentWindowLabel && (
            <div className="file-viewer-truncated">{contentWindowLabel}</div>
          )}
        </div>
      );
    }

    return binaryCard;
  };

  // Binary files, or media this browser cannot decode
  const binaryCard = (
    <div className="file-viewer-binary">
      <p>{t("fileViewerBinary" as never)}</p>
      <p>
        <strong>{t("fileViewerType" as never)}</strong> {metadata?.mimeType}
      </p>
      <p>
        <strong>{t("fileViewerSize" as never)}</strong>{" "}
        {metadata ? formatFileSize(metadata.size) : ""}
      </p>
      {canDownload && (
        <button
          type="button"
          className="file-viewer-download-btn"
          onClick={handleDownload}
        >
          {t("fileViewerDownloadFile" as never)}
        </button>
      )}
    </div>
  );

  // Header with file info and actions
  const header = (
    <div
      ref={setFileHeaderElement}
      className={`file-viewer-header ${headerStyles.header} ${viewerStyles.header}`}
      data-actions-below={stackHeaderActions || undefined}
    >
      <div ref={fileHeaderContextRef} className={viewerStyles.context}>
        {headerLeading}
        {onClose && (
          <button
            type="button"
            className={`file-viewer-action ${viewerStyles.backButton}`}
            onClick={handleClose}
            title={t("actionBack")}
            aria-label={t("actionBack")}
          >
            <BackArrowIcon />
          </button>
        )}
      </div>
      <div
        className={`file-viewer-info ${headerStyles.identity} ${viewerStyles.info}`}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click opens the file action menu; left-click behavior stays on explicit toolbar buttons */}
        <span
          className="file-viewer-path"
          title={filePath}
          onContextMenu={handlePathContextMenu}
        >
          {displayPath}
        </span>
        <div
          ref={fileHeaderProvenanceRef}
          className={viewerStyles.provenanceRow}
        >
          {publicShareContext === null && fileVersionControl.relativePath && (
            <FileRevisionLink
              projectId={projectId}
              path={fileVersionControl.relativePath}
              origPath={fileVersionControl.worktreeFile?.origPath}
              dirtyLabel={t("fileRevisionDirty" as never)}
              uncommittedLabel={t("fileRevisionUncommitted" as never)}
            />
          )}
          <span className="file-viewer-meta">
            {metadata ? formatFileSize(metadata.size) : ""}
            {!diffActive && metadata?.isText && content !== undefined && (
              <>
                {" \u2022 "}
                {fileData?.contentTruncated
                  ? `lines ${getContentStartLine(fileData)}-${getContentEndLine(fileData)}${
                      fileData?.contentTotalLines
                        ? ` of ${fileData.contentTotalLines}`
                        : ""
                    }`
                  : t("fileViewerLines" as never, {
                      count: contentLines.length,
                    })}
              </>
            )}
          </span>
        </div>
      </div>
      <ViewerFindField find={find} />
      <div
        ref={fileHeaderActionsRef}
        className={`file-viewer-actions ${headerStyles.actions} ${viewerStyles.actions}`}
      >
        {publicShareContext === null && (
          <FileDiffViewLinks
            activeView={activeView}
            availability={fileVersionControl}
            onSelect={selectView}
            projectId={projectId}
            sourceHref={sourceViewerUrl}
            variant="header"
          />
        )}
        {!diffActive && hasFilePreview && (
          <button
            type="button"
            className={`file-viewer-action ${viewerStyles.rawToggle}`}
            aria-label={t("fileViewerRawSource" as never)}
            aria-pressed={!showPreview}
            title={t("fileViewerRawSource" as never)}
            onClick={() => {
              setInteractivePreviewIdentity(
                !showPreview && hasHtmlPreview ? viewIdentity : null,
              );
              setShowPreview((visible) => !visible);
            }}
          >
            <RawSourceIcon />
          </button>
        )}
        {commentModeSupported && (
          <button
            type="button"
            className={`file-viewer-action ${viewerStyles.commentToggle}`}
            aria-label={t("fileViewerCommentMode" as never)}
            aria-pressed={commentMode}
            title={t("fileViewerCommentMode" as never)}
            onClick={handleCommentModeToggle}
          >
            <CommentIcon />
          </button>
        )}
        {publicShareContext === null &&
          source === DEFAULT_FILE_VIEWER_SOURCE &&
          !diffActive &&
          metadata?.isText &&
          content !== undefined && (
            <SourceEditAction
              source={{ path: filePath, projectId }}
              line={effectiveLineNumber}
              artifact={hasHtmlPreview}
              onSaved={hasHtmlPreview ? undefined : reloadFromDisk}
            />
          )}
        <span ref={setModeControlsHost} />
        {!diffActive && fileData && (
          <button
            type="button"
            className={`file-viewer-action${freshness?.state === "stale" ? ` ${viewerStyles.reloadStale}` : ""}`}
            aria-label={t("fileViewerReload" as never)}
            title={
              freshness?.state === "stale"
                ? t("fileViewerReloadStale" as never, {
                    time: new Date(freshness.at).toLocaleTimeString(),
                  })
                : freshness?.state === "fresh"
                  ? t("fileViewerReloadFresh" as never)
                  : t("fileViewerReload" as never)
            }
            onMouseEnter={checkFreshness}
            onFocus={checkFreshness}
            onClick={reloadFromDisk}
          >
            <RefreshIcon />
          </button>
        )}
        {!diffActive && metadata?.isText && content !== undefined && (
          <FileViewerDensityControls
            zoom={viewerDensity.zoom}
            canZoomIn={viewerDensity.canZoomIn}
            canZoomOut={viewerDensity.canZoomOut}
            onZoomIn={viewerDensity.zoomIn}
            onZoomOut={viewerDensity.zoomOut}
          />
        )}
        {(diffActive ||
          (!isImage &&
            content !== undefined &&
            !(showPreview && hasHtmlPreview))) && (
          <ViewerSelectAllButton
            className="file-viewer-action"
            contentRef={fileViewerBodyRef}
          />
        )}
        {!diffActive && content !== undefined && (
          <button
            type="button"
            className={`file-viewer-action ${copied ? "copied" : ""}`}
            onClick={handleCopy}
            title={
              copied
                ? t("fileViewerCopied" as never)
                : t("fileViewerCopyContent" as never)
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {publicShareContext === null &&
          source === DEFAULT_FILE_VIEWER_SOURCE &&
          !diffActive && <PublicFileShareButton onOpen={setFileShareAnchor} />}
        {publicShareContext !== null &&
          publicShareContext.projectId !== null &&
          !diffActive &&
          hasHtmlPreview &&
          content !== undefined && (
            <ViewerModeToggle
              mode="interactive"
              source={{}}
              artifact
              href={publicSharePlayHref!}
              active={false}
              label={t("publicSharePlay" as never)}
              onToggle={() =>
                window.open(publicSharePlayHref!, "_blank", "noopener")
              }
            />
          )}
        {publicShareContext === null && (
          <button
            type="button"
            className="file-viewer-action file-viewer-new-session"
            onClick={startNewSession}
            title={t("fileViewerNewSession" as never)}
          >
            <PlusCircleIcon />
          </button>
        )}
        {!diffActive && canDownload && (
          <button
            type="button"
            className="file-viewer-action"
            onClick={handleDownload}
            title={t("fileViewerDownload" as never)}
          >
            <DownloadIcon />
          </button>
        )}
        <button
          type="button"
          className={`file-viewer-action file-viewer-fullscreen-toggle ${viewerStyles.fullscreenButton}`}
          onClick={() => setFullscreen(!fullscreen)}
          title={
            fullscreen
              ? t("fileViewerExitFullscreen" as never)
              : t("fileViewerFullscreen" as never)
          }
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
        <ViewerWindowActions
          className={viewerStyles.windowActions}
          url={absoluteViewerLink}
          moveOut={!standalone}
          onMinimize={onMinimize ? handleMinimize : undefined}
          onClose={onClose ? handleClose : undefined}
          minimizeLabel={t("fileViewerMinimize")}
        />
      </div>
    </div>
  );

  const viewerClass = [
    "file-viewer",
    viewerStyles.viewer,
    standalone && "file-viewer-standalone",
    fullscreen && "file-viewer-fullscreen",
    effectiveViewMode === "range" && "file-viewer-compact",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={viewerClass} onBlurCapture={handleViewerBlur}>
      {header}
      {fileShareAnchor && (
        <PublicFileShareModal
          anchorRect={fileShareAnchor}
          filePath={filePath}
          projectId={projectId}
          title={fileName}
          // While the interactive preview runs, copied links open play mode.
          transformUrl={
            interactivePreviewIdentity === viewIdentity
              ? (url) => publicSharePlayUrlFromFileShareUrl(url) ?? url
              : undefined
          }
          onClose={() => setFileShareAnchor(null)}
        />
      )}
      {contextMenu && (
        <FilePathContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canStartNewSession={publicShareContext === null}
          onClose={closeContextMenu}
          onOpen={handleOpenInNewTab}
          onOpenSource={
            supportsSourceAndPreview(filePath)
              ? () => {
                  setInteractivePreviewIdentity(null);
                  setShowPreview(false);
                }
              : undefined
          }
          onOpenPreview={
            supportsSourceAndPreview(filePath) && hasFilePreview
              ? () => {
                  setInteractivePreviewIdentity(viewIdentity);
                  setShowPreview(true);
                }
              : undefined
          }
          onStartNewSession={startNewSession}
          onCopyProjectRelativePath={
            projectRelativeCopyPath
              ? () => void writeClipboardText(projectRelativeCopyPath)
              : undefined
          }
          onCopyAbsolutePath={
            publicShareContext === null && absoluteCopyPath
              ? () => void writeClipboardText(absoluteCopyPath)
              : undefined
          }
          onCopyFilePath={
            !projectRelativeCopyPath && !absoluteCopyPath
              ? () => void writeClipboardText(filePath)
              : undefined
          }
          onCopyViewerLink={() => void writeClipboardText(absoluteViewerLink)}
          onCopyContents={handleCopyContentsFromMenu}
          onCopyRenderedContents={
            renderedClipboardPayload
              ? handleCopyRenderedContentsFromMenu
              : undefined
          }
        />
      )}
      {localResourceContextMenu}
      {loadedIsImage ? imageActions.contextMenuElement : null}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: delegated source-line clicks complement keyboard text-selection comments; the focusable body retains native keyboard scrolling */}
      <div
        className={`file-viewer-body ${viewerStyles.body} ${
          quoteTextBlock && showPreview && hasMarkdownPreview
            ? viewerStyles.quoteReplySurface
            : ""
        }`}
        ref={setBodyElement}
        tabIndex={-1}
        {...(commentMode ? { [SESSION_FILE_COMMENT_MODE_ATTR]: "true" } : {})}
        onClick={handleViewerBodyClick}
        onMouseDownCapture={handleViewerBodyMouseDownCapture}
        onPointerDown={handleViewerBodyPointerDown}
      >
        {commentEditor &&
        splitCommentAfterLine === undefined &&
        splitCommentAfterBlock === undefined ? (
          <ReviewCommentSplitLayout
            before={renderContent()}
            editor={commentEditor}
          />
        ) : (
          renderContent()
        )}
        {!commentMode && quoteTextBlock && showPreview && hasMarkdownPreview ? (
          <ParagraphQuoteRail
            alwaysShowQuoteCircle={quoteReplyButtonMode === "paragraph-always"}
            contentRef={markdownPreviewRef}
            layoutKey={`${filePath}\0${renderedMarkdownHtml ?? ""}`}
            onQuoteBlock={quoteTextBlock}
            paragraphQuoteCirclesEnabled={quoteReplyButtonMode !== "block"}
            sourceRef={fileViewerBodyRef}
            surfaceRef={fileViewerBodyRef}
          />
        ) : null}
        {standalone ? (
          <FileViewerSelectionActions
            containerRef={fileViewerBodyRef}
            onStartNewSessionFromSelection={
              publicShareContext === null
                ? startNewSessionFromSelection
                : undefined
            }
          />
        ) : null}
      </div>
      {localMediaModal ? (
        <LocalMediaModal
          path={localMediaModal.path}
          mediaType={localMediaModal.mediaType}
          mediaSource={mediaSource}
          dismissOnBack
          parentViewerId={
            localMediaModal.mediaType === "image" ? parentViewerId : undefined
          }
          onClose={closeLocalMediaModal}
        />
      ) : null}
      {localFileModal ? (
        <LocalFileModal
          resource={localFileModal.resource}
          initialPresentation={localFileModal.initialPresentation}
          dismissOnBack
          onClose={closeLocalFileModal}
        />
      ) : null}
      {projectFileModal ? (
        <FileViewerModal
          nestedViewer
          projectId={projectFileModal.projectId}
          filePath={projectFileModal.filePath}
          lineNumber={projectFileModal.lineNumber}
          lineEnd={projectFileModal.lineEnd}
          initialPresentation={projectFileModal.initialPresentation}
          onClose={closeProjectFileModal}
        />
      ) : null}
    </div>
  );
});

function FileViewerSelectionActions({
  containerRef,
  onStartNewSessionFromSelection,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  onStartNewSessionFromSelection?: (prefill: string) => void;
}) {
  const { floatingSelectionActions, selectionContextMenu } =
    useSelectionActions({
      containerRef,
      inert: false,
      onStartNewSessionFromSelection,
      quoteClearSignal: 0,
      isInteractiveTarget: (target) =>
        target instanceof Element &&
        target.closest(
          "button, input, textarea, select, a[href], [contenteditable='true']",
        ) !== null,
    });

  return (
    <>
      {floatingSelectionActions}
      {selectionContextMenu}
    </>
  );
}

// Icons
function RefreshIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3.2h-3.2" />
    </svg>
  );
}

function RawSourceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9.5 2.5l-3 11" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function PublicFileShareButton({
  onOpen,
}: {
  onOpen: (anchor: DOMRect) => void;
}) {
  const { t } = useI18n();
  const { version } = useVersion();
  const { status } = usePublicShareStatus();
  if (
    status?.canCreate !== true ||
    !serverHasCapability(version, PUBLIC_FILE_SHARES_CAPABILITY)
  ) {
    return null;
  }
  return (
    <button
      type="button"
      className="file-viewer-action"
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
      title={t("fileViewerSharePublicly")}
      aria-label={t("fileViewerSharePublicly")}
    >
      <PublicLinkIcon />
    </button>
  );
}

function PublicLinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 12 4-4M6.5 14.5l-1 1a2.8 2.8 0 0 1-4-4l3-3a2.8 2.8 0 0 1 4 0M13.5 5.5l1-1a2.8 2.8 0 1 1 4 4l-3 3a2.8 2.8 0 0 1-4 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  );
}

function PlusCircleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v6M5 8h6" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3.5h10v7H7l-3.5 2.5v-2.5H3z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v9M4 8l4 4 4-4M2 14h12" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 2v3H2M14 5h-3V2M11 14v-3h3M2 11h3v3" />
    </svg>
  );
}
