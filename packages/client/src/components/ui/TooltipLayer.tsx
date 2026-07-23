import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  beginTooltipVisibility,
  endTooltipVisibility,
  getEffectiveTooltipDelayMs,
  useTooltipAppearance,
} from "../../hooks/useTooltipAppearance";
import { writeClipboardText } from "../../lib/clipboard";

const TOOLTIP_ID = "ya-global-tooltip";
const VIEWPORT_MARGIN_PX = 8;
const POINTER_OFFSET_PX = 14;

interface VisibleTooltip {
  text: string;
  anchorX: number;
  anchorY: number;
}

interface SavedTitle {
  target: Element;
  value: string;
}

interface SavedDescription {
  target: Element;
  value: string | null;
}

function pointerCanHover(event: PointerEvent): boolean {
  return event.pointerType !== "touch";
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function tooltipTargetFromNode(
  node: EventTarget | null,
  activeTarget: Element | null,
): Element | null {
  if (!(node instanceof Element)) return null;
  if (activeTarget?.contains(node)) return activeTarget;
  return node.closest("[data-tooltip], [title]");
}

function appendDescriptionId(target: Element): SavedDescription {
  const value = target.getAttribute("aria-describedby");
  const ids = new Set(value?.split(/\s+/).filter(Boolean) ?? []);
  ids.add(TOOLTIP_ID);
  target.setAttribute("aria-describedby", [...ids].join(" "));
  return { target, value };
}

function restoreDescription(saved: SavedDescription | null): void {
  if (!saved?.target.isConnected) return;
  if (saved.value === null) {
    saved.target.removeAttribute("aria-describedby");
  } else {
    saved.target.setAttribute("aria-describedby", saved.value);
  }
}

function hasSelectedText(): boolean {
  const selection = document.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString() !== "";
}

function isContextMenuOperable(event: MouseEvent): boolean {
  if (event.defaultPrevented || hasSelectedText()) return true;
  if (!(event.target instanceof Element)) return false;
  return (
    event.target.closest(
      'a[href], input, textarea, select, [contenteditable="true"], img, video, audio, [data-context-menu]',
    ) !== null
  );
}

/**
 * One delegated text-tooltip layer covers existing `title=` affordances and
 * explicit `data-tooltip` targets without forcing every renderer to own
 * positioning, dwell, adjacency, and accessibility state.
 */
export function TooltipLayer() {
  const { tooltipMode, tooltipDelayMs } = useTooltipAppearance();
  const [visible, setVisible] = useState<VisibleTooltip | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeTargetRef = useRef<Element | null>(null);
  const movementDismissedTargetRef = useRef<Element | null>(null);
  const savedTitleRef = useRef<SavedTitle | null>(null);
  const savedDescriptionRef = useRef<SavedDescription | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityTokenRef = useRef<symbol | null>(null);
  const visibleRef = useRef(false);
  const visibleTooltipRef = useRef<VisibleTooltip | null>(visible);
  visibleRef.current = visible !== null;
  visibleTooltipRef.current = visible;

  const clearShowTimer = useCallback(() => {
    if (!showTimerRef.current) return;
    clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
  }, []);

  const restoreTitle = useCallback(() => {
    const saved = savedTitleRef.current;
    savedTitleRef.current = null;
    if (
      saved?.target.isConnected &&
      !saved.target.hasAttribute("title")
    ) {
      saved.target.setAttribute("title", saved.value);
    }
  }, []);

  const captureTitle = useCallback((target: Element): string => {
    const liveTitle = target.getAttribute("title");
    if (liveTitle === null) {
      return savedTitleRef.current?.target === target
        ? savedTitleRef.current.value
        : "";
    }
    savedTitleRef.current = { target, value: liveTitle };
    target.removeAttribute("title");
    return liveTitle;
  }, []);

  const releaseVisibility = useCallback(() => {
    const token = visibilityTokenRef.current;
    visibilityTokenRef.current = null;
    if (token) endTooltipVisibility(token);
    restoreDescription(savedDescriptionRef.current);
    savedDescriptionRef.current = null;
  }, []);

  const hide = useCallback(() => {
    clearShowTimer();
    releaseVisibility();
    restoreTitle();
    activeTargetRef.current = null;
    visibleRef.current = false;
    visibleTooltipRef.current = null;
    setEnlarged(false);
    setVisible(null);
  }, [clearShowTimer, releaseVisibility, restoreTitle]);

  const show = useCallback(
    (target: Element, anchorX: number, anchorY: number) => {
      showTimerRef.current = null;
      if (activeTargetRef.current !== target || !target.isConnected) return;
      const currentText =
        target.getAttribute("data-tooltip") ?? captureTitle(target);
      if (!currentText.trim()) return;
      visibilityTokenRef.current ??= beginTooltipVisibility();
      restoreDescription(savedDescriptionRef.current);
      savedDescriptionRef.current = appendDescriptionId(target);
      visibleRef.current = true;
      const resolvedAnchorX = finiteCoordinate(anchorX);
      const resolvedAnchorY = finiteCoordinate(anchorY);
      setPosition({
        left: resolvedAnchorX + POINTER_OFFSET_PX,
        top: resolvedAnchorY + POINTER_OFFSET_PX,
      });
      setVisible({
        text: currentText,
        anchorX: resolvedAnchorX,
        anchorY: resolvedAnchorY,
      });
    },
    [captureTitle],
  );

  const schedule = useCallback(
    (target: Element, anchorX: number, anchorY: number) => {
      clearShowTimer();
      const delayMs = getEffectiveTooltipDelayMs();
      if (delayMs === 0) {
        show(target, anchorX, anchorY);
      } else {
        showTimerRef.current = setTimeout(
          () => show(target, anchorX, anchorY),
          delayMs,
        );
      }
    },
    [clearShowTimer, show, tooltipDelayMs],
  );

  const activate = useCallback(
    (target: Element, anchorX: number, anchorY: number) => {
      if (target !== activeTargetRef.current) {
        hide();
        activeTargetRef.current = target;
      }
      const title = captureTitle(target);
      const text = target.getAttribute("data-tooltip") ?? title;
      if (!text.trim()) {
        hide();
        return;
      }
      if (!visibleRef.current) schedule(target, anchorX, anchorY);
    },
    [captureTitle, hide, schedule],
  );

  useEffect(() => {
    if (tooltipMode !== "themed") {
      movementDismissedTargetRef.current = null;
      hide();
      return;
    }

    const onPointerOver = (event: PointerEvent) => {
      if (!pointerCanHover(event)) return;
      const dismissedTarget = movementDismissedTargetRef.current;
      if (
        dismissedTarget &&
        event.target instanceof Node &&
        dismissedTarget.contains(event.target)
      ) {
        return;
      }
      movementDismissedTargetRef.current = null;
      const target = tooltipTargetFromNode(
        event.target,
        activeTargetRef.current,
      );
      if (target) activate(target, event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerCanHover(event)) return;
      const target = tooltipTargetFromNode(
        event.target,
        activeTargetRef.current,
      );
      if (!target) {
        hide();
        return;
      }
      if (movementDismissedTargetRef.current === target) return;
      if (!visibleRef.current) {
        activate(target, event.clientX, event.clientY);
      } else {
        movementDismissedTargetRef.current = target;
        hide();
      }
    };
    const onPointerOut = (event: PointerEvent) => {
      const activeTarget = activeTargetRef.current;
      const dismissedTarget = movementDismissedTargetRef.current;
      if (
        dismissedTarget &&
        !(
          event.relatedTarget instanceof Node &&
          dismissedTarget.contains(event.relatedTarget)
        )
      ) {
        movementDismissedTargetRef.current = null;
      }
      if (!activeTarget) return;
      if (
        event.relatedTarget instanceof Node &&
        activeTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = tooltipTargetFromNode(
        event.target,
        activeTargetRef.current,
      );
      if (!target) return;
      const rect = target.getBoundingClientRect();
      activate(target, rect.left + rect.width / 2, rect.bottom);
    };
    const onFocusOut = (event: FocusEvent) => {
      const activeTarget = activeTargetRef.current;
      if (
        activeTarget &&
        event.relatedTarget instanceof Node &&
        activeTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) {
        movementDismissedTargetRef.current = activeTargetRef.current;
        hide();
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      const currentTooltip = visibleTooltipRef.current;
      const activeTarget = activeTargetRef.current;
      if (
        !currentTooltip ||
        !activeTarget ||
        !(event.target instanceof Node) ||
        !activeTarget.contains(event.target) ||
        isContextMenuOperable(event)
      ) {
        return;
      }
      event.preventDefault();
      setEnlarged(true);
      void writeClipboardText(currentTooltip.text);
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      hide();
    };
  }, [activate, hide, tooltipMode]);

  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!element || !visible) return;
    const rect = element.getBoundingClientRect();
    let left = visible.anchorX + POINTER_OFFSET_PX;
    let top = visible.anchorY + POINTER_OFFSET_PX;
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN_PX) {
      left = visible.anchorX - rect.width - POINTER_OFFSET_PX;
    }
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN_PX) {
      top = visible.anchorY - rect.height - POINTER_OFFSET_PX;
    }
    setPosition({
      left: Math.max(VIEWPORT_MARGIN_PX, left),
      top: Math.max(VIEWPORT_MARGIN_PX, top),
    });
  }, [visible]);

  if (tooltipMode !== "themed" || !visible) return null;
  return createPortal(
    <div
      ref={tooltipRef}
      id={TOOLTIP_ID}
      className={`ya-tooltip${enlarged ? " ya-tooltip--enlarged" : ""}`}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      {visible.text}
    </div>,
    document.body,
  );
}
