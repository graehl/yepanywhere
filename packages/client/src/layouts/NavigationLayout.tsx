import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { useSidebarPreference } from "../hooks/useSidebarPreference";
import {
  DESKTOP_BREAKPOINT,
  MIN_CONTENT_WIDTH,
  useSidebarWidth,
} from "../hooks/useSidebarWidth";

export interface NavigationLayoutContext {
  /** Open the mobile sidebar */
  openSidebar: () => void;
  /** Whether we're in desktop mode (wide screen) */
  isWideScreen: boolean;
  /** Desktop mode: sidebar is collapsed (icons only) */
  isSidebarCollapsed: boolean;
  /** Desktop mode: callback to toggle sidebar expanded/collapsed state */
  toggleSidebar: () => void;
}

const NOOP = () => {};

interface ResponsiveLayoutState {
  isWideScreen: boolean;
  canShowExpandedSidebar: boolean;
}

function getViewportWidth(): number {
  return typeof window === "undefined" ? 1200 : window.innerWidth;
}

function getResponsiveLayoutState(
  sidebarWidth: number,
  viewportWidth = getViewportWidth(),
): ResponsiveLayoutState {
  return {
    isWideScreen: viewportWidth >= DESKTOP_BREAKPOINT,
    canShowExpandedSidebar: viewportWidth >= sidebarWidth + MIN_CONTENT_WIDTH,
  };
}

function responsiveLayoutStateEquals(
  left: ResponsiveLayoutState,
  right: ResponsiveLayoutState,
): boolean {
  return (
    left.isWideScreen === right.isWideScreen &&
    left.canShowExpandedSidebar === right.canShowExpandedSidebar
  );
}

/**
 * Shared layout for all pages that need a sidebar.
 * Renders the Sidebar once so it persists across route changes.
 */
export function NavigationLayout() {
  // Extract sessionId from URL for highlighting in sidebar (works for session pages)
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const forceExpandedSidebar =
    new URLSearchParams(location.search).get("sidebar") === "expanded";
  const { isExpanded, toggleExpanded } =
    useSidebarPreference(forceExpandedSidebar);
  const {
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    isResizing,
    setIsResizing,
  } = useSidebarWidth();
  const [responsiveLayout, setResponsiveLayout] = useState(() =>
    getResponsiveLayoutState(sidebarWidth),
  );
  const updateResponsiveLayout = useCallback(() => {
    const next = getResponsiveLayoutState(sidebarWidth);
    setResponsiveLayout((previous) =>
      responsiveLayoutStateEquals(previous, next) ? previous : next,
    );
  }, [sidebarWidth]);

  useEffect(() => {
    updateResponsiveLayout();

    let frameId = 0;
    const handleResize = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateResponsiveLayout();
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [updateResponsiveLayout]);

  const { isWideScreen, canShowExpandedSidebar } = responsiveLayout;
  // Auto-collapse if viewport too narrow for expanded sidebar, or if user prefers collapsed
  const effectivelyCollapsed = !isExpanded || !canShowExpandedSidebar;

  // Close mobile sidebar overlay when viewport becomes wide enough for expanded desktop sidebar
  // This prevents having both sidebars visible after window resize/device rotation
  // Only auto-close when desktop sidebar is actually visible (isWideScreen)
  useEffect(() => {
    if (sidebarOpen && isWideScreen && canShowExpandedSidebar) {
      setSidebarOpen(false);
    }
  }, [canShowExpandedSidebar, isWideScreen, sidebarOpen]);

  // Smart toggle: if viewport can support expanded, toggle preference; otherwise open overlay
  const handleToggleExpanded = useCallback(() => {
    if (canShowExpandedSidebar) {
      toggleExpanded();
    } else {
      // Viewport too narrow for expanded sidebar - open mobile-style overlay instead
      setSidebarOpen(true);
    }
  }, [canShowExpandedSidebar, toggleExpanded]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const handleResizeStart = useCallback(
    () => setIsResizing(true),
    [setIsResizing],
  );
  const handleResizeEnd = useCallback(
    () => setIsResizing(false),
    [setIsResizing],
  );

  const context: NavigationLayoutContext = useMemo(
    () => ({
      openSidebar,
      isWideScreen,
      isSidebarCollapsed: effectivelyCollapsed,
      toggleSidebar: handleToggleExpanded,
    }),
    [effectivelyCollapsed, handleToggleExpanded, isWideScreen, openSidebar],
  );

  // CSS variable for sidebar width
  const containerStyle = useMemo(
    () =>
      isWideScreen
        ? ({ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties)
        : undefined,
    [isWideScreen, sidebarWidth],
  );
  const desktopSidebarStyle = useMemo(
    () => ({ width: effectivelyCollapsed ? undefined : sidebarWidth }),
    [effectivelyCollapsed, sidebarWidth],
  );

  return (
    <div
      className={`session-page ${isWideScreen ? "desktop-layout" : ""} ${isResizing ? "resizing" : ""}`}
      style={containerStyle}
    >
      {/* Desktop sidebar - always visible on wide screens */}
      {isWideScreen && (
        <aside
          className={`sidebar-desktop ${effectivelyCollapsed ? "sidebar-collapsed" : ""} ${isResizing ? "resizing" : ""}`}
          style={desktopSidebarStyle}
        >
          <Sidebar
            isOpen={true}
            onClose={NOOP}
            onNavigate={NOOP}
            currentSessionId={sessionId}
            isDesktop={true}
            isCollapsed={effectivelyCollapsed}
            onToggleExpanded={handleToggleExpanded}
            sidebarWidth={sidebarWidth}
            onResizeStart={handleResizeStart}
            onResize={setSidebarWidth}
            onResizeEnd={handleResizeEnd}
          />
        </aside>
      )}

      {/* Mobile sidebar - modal overlay (also used for constrained desktop overlay) */}
      {(!isWideScreen || sidebarOpen) && (
        <Sidebar
          isOpen={sidebarOpen}
          onClose={closeSidebar}
          onNavigate={closeSidebar}
          currentSessionId={sessionId}
        />
      )}

      {/* Child route content */}
      <Outlet context={context} />
    </div>
  );
}

/**
 * Hook for child routes to access the shared navigation layout context.
 */
export function useNavigationLayout(): NavigationLayoutContext {
  return useOutletContext<NavigationLayoutContext>();
}
