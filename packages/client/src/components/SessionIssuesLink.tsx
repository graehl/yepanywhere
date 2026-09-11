import type { IssueItem, IssueSearchResult } from "@yep-anywhere/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useIssuesEnabled } from "../hooks/useIssuesEnabled";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useTextTooltipAttributes } from "../hooks/useTooltipAppearance";
import { useI18n } from "../i18n";
import { IssueIcon } from "./IssueIcon";
import styles from "./SessionIssuesLink.module.css";

/** One page of the list route supplies the count; a fuller page reads "N+". */
const COUNT_PAGE = 100;
/** Let a burst of new messages settle before asking for a fresh count. */
const SETTLE_MS = 3000;
/** Recheck cadence while the server reports indexing work in flight. */
const INDEXING_MS = 4000;
/**
 * Opening or extending a session queues its text for indexing, so the first
 * answer usually predates the references in it. These delays follow a count
 * until it settles and then stop: a bounded recheck, never a standing poll.
 */
const RECHECK_MS = [2000, 5000, 10000];
/** A header menu stays scannable; the rest stay one click away on the page. */
const MENU_ROWS = 12;
/** Keep the menu off both screen edges on a phone. */
const MENU_MARGIN_PX = 8;

interface KnownIssues {
  items: IssueItem[];
  count: number;
  more: boolean;
}

/**
 * This session's undismissed associations, as the header last read them.
 *
 * Discovery is asynchronous server-side work, so the header keeps the last
 * answer it actually read: it refreshes when the transcript grows and while the
 * indexer reports active work, and reports nothing at all rather than a count
 * it cannot currently confirm. The same page that supplies the count supplies
 * the menu rows, so opening the menu costs no further request.
 */
function useSessionIssues(
  sessionId: string,
  projectId: string,
  enabled: boolean,
  messageCount: number,
): KnownIssues | null {
  const { transport } = useCurrentSourceRuntime();
  const [known, setKnown] = useState<KnownIssues | null>(null);
  const loaded = useRef<{ transport: unknown; key: string } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount is the trigger for a fresh count, not an input to the request
  useEffect(() => {
    if (!enabled) {
      setKnown(null);
      loaded.current = null;
      return;
    }
    // A different session or server invalidates the displayed count instead of
    // showing the previous one beside the new header.
    const key = `${projectId} ${sessionId}`;
    const first =
      loaded.current?.transport !== transport || loaded.current.key !== key;
    if (first) setKnown(null);
    loaded.current = { transport, key };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rechecks = 0;
    const load = async () => {
      let active = false;
      try {
        const result = await transport.fetch<IssueSearchResult>(
          `/issues?${new URLSearchParams({
            sessionId,
            projectId,
            limit: String(COUNT_PAGE),
          })}`,
        );
        if (disposed) return;
        active = result.coverage.active;
        setKnown({
          items: result.items,
          count: result.items.length,
          more: result.nextOffset !== null,
        });
      } catch {
        // An unreadable count drops the badge rather than keeping a number the
        // server no longer confirms; the remaining rechecks can recover it.
        if (disposed) return;
        setKnown(null);
      }
      const next =
        rechecks < RECHECK_MS.length
          ? active
            ? INDEXING_MS
            : RECHECK_MS[rechecks]
          : undefined;
      rechecks += 1;
      if (next !== undefined) timer = setTimeout(() => void load(), next);
    };
    timer = setTimeout(() => void load(), first ? 0 : SETTLE_MS);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, messageCount, projectId, sessionId, transport]);
  return known;
}

const KIND_LABELS = {
  issue: "issuesKind_issue",
  pr: "issuesKind_pr",
  unknown: "issuesKind_unknown",
} as const;

/**
 * Everything the row cannot show: the full title, where the reference lives,
 * how widely it is mentioned, and what a click will do.
 */
function useItemTooltip(item: IssueItem): string {
  const { t } = useI18n();
  const kindKey = KIND_LABELS[item.kind as keyof typeof KIND_LABELS];
  const lines = [
    item.title ?? item.key,
    [
      item.title ? item.key : null,
      item.provider,
      kindKey ? t(kindKey) : item.kind,
      t(
        item.sessionCount === 1 ? "issuesSingleSession" : "issuesSessionCount",
        {
          count: item.sessionCount,
        },
      ),
    ]
      .filter(Boolean)
      .join(" · "),
    item.unresolved ? t("issuesUnresolved") : null,
    item.url,
    item.url ? t("issuesMenuOpenHint") : t("issuesMenuNoUrlHint"),
  ];
  return lines.filter(Boolean).join("\n");
}

function IssueMenuRow({
  item,
  fallbackHref,
  onSelect,
}: {
  item: IssueItem;
  /** Where a reference with no known tracker URL goes instead. */
  fallbackHref: string;
  onSelect: () => void;
}) {
  const tooltip = useItemTooltip(item);
  const tooltipProps = useTextTooltipAttributes(tooltip);
  const content = (
    <>
      <IssueIcon size={14} />
      <span className={styles.itemKey}>{item.key}</span>
      {item.title && <span className={styles.itemTitle}>{item.title}</span>}
    </>
  );
  // A plain href in both branches keeps the browser's own middle-click and
  // modifier-click handling: a left click navigates, anything else opens a tab.
  return item.url ? (
    <a
      className={styles.item}
      role="menuitem"
      href={item.url}
      rel="noreferrer"
      onClick={onSelect}
      {...tooltipProps}
    >
      {content}
    </a>
  ) : (
    <Link
      className={styles.item}
      role="menuitem"
      to={fallbackHref}
      onClick={onSelect}
      {...tooltipProps}
    >
      {content}
    </Link>
  );
}

export function SessionIssuesLink({
  sessionId,
  projectId,
  messageCount = 0,
}: {
  sessionId: string;
  projectId: string;
  /** Transcript length; a change asks the server for a fresh count. */
  messageCount?: number;
}) {
  const enabled = useIssuesEnabled();
  const base = useRemoteBasePath();
  const { t } = useI18n();
  const known = useSessionIssues(sessionId, projectId, enabled, messageCount);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rows = known?.items.slice(0, MENU_ROWS) ?? [];
  const hidden = known ? known.count - rows.length : 0;

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    setPosition(undefined);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  // Anchor the menu under the trigger's right edge, flipping above and
  // sliding inward rather than leaving the viewport.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a count that lands while the menu is open changes its height, so the measured rows re-run the placement
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const below = rect.bottom + 4;
    const fitsBelow = below + height <= window.innerHeight - MENU_MARGIN_PX;
    setPosition({
      top: fitsBelow ? below : Math.max(MENU_MARGIN_PX, rect.top - height - 4),
      left: Math.max(
        MENU_MARGIN_PX,
        Math.min(
          rect.right - width,
          window.innerWidth - width - MENU_MARGIN_PX,
        ),
      ),
    });
  }, [open, rows.length, hidden]);

  // The first row takes focus so the menu is usable from the keyboard even
  // though the portal sits outside the header's tab order.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onScrollOrResize = () => close(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  const badge = known?.more
    ? `${known.count}+`
    : known && known.count > 0
      ? String(known.count)
      : null;
  const label = badge
    ? t(
        known?.count === 1 && !known.more
          ? "issuesForSessionCountOne"
          : "issuesForSessionCountMany",
        { count: badge },
      )
    : t("issuesForSession");
  const triggerTooltip = useTextTooltipAttributes(label);
  if (!enabled) return null;

  const browseHref = `${base}/issues?${new URLSearchParams({ sessionId, projectId })}`;

  const moveFocus = (step: number, event: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      step > 0 ? (at + 1) % items.length : (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  };

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          style={{
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            visibility: position ? "visible" : "hidden",
          }}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") moveFocus(1, event);
            else if (event.key === "ArrowUp") moveFocus(-1, event);
            else if (event.key === "Tab") close(false);
          }}
        >
          {rows.length === 0 && (
            <p className={styles.empty}>{t("issuesMenuEmpty")}</p>
          )}
          {rows.map((item) => (
            <IssueMenuRow
              key={item.id}
              item={item}
              fallbackHref={browseHref}
              onSelect={() => close(false)}
            />
          ))}
          {hidden > 0 && (
            <p className={styles.more}>
              {t("issuesMenuMore", { count: hidden })}
            </p>
          )}
          <Link
            className={styles.browse}
            role="menuitem"
            to={browseHref}
            onClick={() => close(false)}
          >
            {t("issuesMenuBrowse")}
          </Link>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        {...triggerTooltip}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IssueIcon />
        {badge && <span className={styles.count}>{badge}</span>}
      </button>
      {menu}
    </>
  );
}
