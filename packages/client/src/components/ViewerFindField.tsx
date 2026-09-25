import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ViewerFind } from "../hooks/useViewerFind";
import { useI18n } from "../i18n";
import { useModalLayer } from "./ui/Modal";
import styles from "./ViewerFindField.module.css";

// Wide enough for a short query plus its "12/345" count.
const FIELD_MIN_WIDTH_PX = 176;

/**
 * Whether the field fits on the header's first row beside everything else.
 * Viewer headers wrap greedily (ViewerHeader.module.css), so an idle field
 * that does not fit is hidden rather than pushing the actions to another row.
 * In a modal the field sits inside the header's actions, so the row measured
 * is the modal header itself.
 */
function useHeaderRoom(field: HTMLElement | null): boolean {
  const [room, setRoom] = useState(false);
  useLayoutEffect(() => {
    const row =
      field?.closest<HTMLElement>(".modal-header") ?? field?.parentElement;
    if (!field || !row || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const style = getComputedStyle(row);
      const gap = Number.parseFloat(style.columnGap) || 0;
      let used = 0;
      let items = 0;
      for (const child of row.children) {
        if (child === field || !(child instanceof HTMLElement)) continue;
        const childStyle = getComputedStyle(child);
        if (childStyle.display === "none" || childStyle.position === "absolute")
          continue;
        items += 1;
        // A growing item (the title) needs only its basis to stay on the row.
        used +=
          Number.parseFloat(childStyle.flexGrow) > 0
            ? Number.parseFloat(childStyle.flexBasis) || 0
            : child.offsetWidth -
              (child.contains(field) ? field.offsetWidth : 0);
      }
      const width =
        row.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
      setRoom(width - used - gap * items >= FIELD_MIN_WIDTH_PX);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of row.children)
      if (child !== field) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [field]);
  return room;
}

/** Isearch-style find field for a viewer header. */
export function ViewerFindField({ find }: { find: ViewerFind }) {
  const { t } = useI18n();
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const room = useHeaderRoom(field);
  const composing = useRef(false);
  const hintId = useId();
  // While a search is open, Escape closes it before it closes the viewer,
  // as a browser's find bar does.
  useModalLayer(
    find.dismiss,
    find.available && (find.active || Boolean(find.query)),
    { lockScroll: false },
  );
  if (!find.available) return null;
  const { counts } = find;
  const status = !counts
    ? ""
    : counts.total === 0
      ? t("viewerFindNoMatches")
      : t("viewerFindCount", {
          current: counts.current,
          total: counts.capped ? `${counts.total}+` : counts.total,
        });
  return (
    <div
      ref={setField}
      className={styles.find}
      role="search"
      hidden={!room && !find.active && !find.query}
    >
      <input
        ref={find.inputRef}
        className={styles.input}
        type="search"
        value={find.query}
        placeholder={t("viewerFindPlaceholder")}
        aria-label={t("viewerFindLabel")}
        aria-describedby={hintId}
        spellCheck={false}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (composing.current) return;
          const mod = event.ctrlKey || event.metaKey;
          const key = event.key.toLowerCase();
          let direction: 1 | -1 | null = null;
          if (event.key === "Enter" || event.key === "F3")
            direction = event.shiftKey ? -1 : 1;
          else if (mod && !event.altKey && (key === "s" || key === "f"))
            direction = 1;
          else if (mod && !event.altKey && key === "g")
            direction = event.shiftKey ? -1 : 1;
          else if (mod && !event.altKey && key === "r") direction = -1;
          if (direction !== null) {
            event.preventDefault();
            event.stopPropagation();
            find.step(direction);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            find.dismiss();
          }
        }}
      />
      <span
        className={styles.count}
        data-empty={counts?.total === 0 || undefined}
        aria-live="polite"
      >
        {status}
      </span>
      <span id={hintId} className={styles.hint}>
        {t("viewerFindHint")}
      </span>
    </div>
  );
}
