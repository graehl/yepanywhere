import {
  type FocusEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  beginTooltipVisibility,
  endTooltipVisibility,
  getEffectiveTooltipDelayMs,
  useTooltipAppearance,
} from "./useTooltipAppearance";

interface TooltipTriggerOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delayMultiplier?: number;
}

/**
 * Dwell-delayed trigger behavior for rich tooltip surfaces that cannot use the
 * shared text-only layer. Pointer movement restarts the first-open timer;
 * keyboard focus uses the same delay. Native mode preserves each surface's
 * prior immediate behavior.
 */
export function useTooltipTrigger({
  open,
  onOpenChange,
  delayMultiplier = 1,
}: TooltipTriggerOptions) {
  const { tooltipMode } = useTooltipAppearance();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityTokenRef = useRef<symbol | null>(null);
  const movementDismissedRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseVisibility = useCallback(() => {
    const token = visibilityTokenRef.current;
    if (!token) return;
    visibilityTokenRef.current = null;
    endTooltipVisibility(token);
  }, []);

  const show = useCallback(() => {
    timerRef.current = null;
    if (!visibilityTokenRef.current && tooltipMode === "themed") {
      visibilityTokenRef.current = beginTooltipVisibility();
    }
    onOpenChange(true);
  }, [onOpenChange, tooltipMode]);

  const schedule = useCallback(() => {
    clearTimer();
    if (openRef.current) return;
    const delayMs =
      tooltipMode === "native"
        ? 0
        : getEffectiveTooltipDelayMs(delayMultiplier);
    if (delayMs === 0) {
      show();
      return;
    }
    timerRef.current = setTimeout(show, delayMs);
  }, [clearTimer, delayMultiplier, show, tooltipMode]);

  const close = useCallback(() => {
    clearTimer();
    releaseVisibility();
    onOpenChange(false);
  }, [clearTimer, onOpenChange, releaseVisibility]);

  const onPointerEnter = useCallback(() => {
    movementDismissedRef.current = false;
    schedule();
  }, [schedule]);
  const onPointerMove = useCallback(() => {
    if (movementDismissedRef.current) return;
    if (openRef.current && tooltipMode === "themed") {
      movementDismissedRef.current = true;
      close();
    } else if (!openRef.current) {
      schedule();
    }
  }, [close, schedule, tooltipMode]);
  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      movementDismissedRef.current = false;
      close();
    },
    [close],
  );
  const onFocus = useCallback(() => {
    movementDismissedRef.current = false;
    schedule();
  }, [schedule]);
  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      movementDismissedRef.current = false;
      close();
    },
    [close],
  );

  useEffect(() => {
    if (!open) releaseVisibility();
  }, [open, releaseVisibility]);

  useEffect(
    () => () => {
      clearTimer();
      releaseVisibility();
    },
    [clearTimer, releaseVisibility],
  );

  return {
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onFocus,
    onBlur,
    cancelPending: clearTimer,
    close,
  };
}
