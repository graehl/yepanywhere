import { createContext, useContext, useEffect, useState } from "react";

/**
 * Shared per-pane title for settings pages.
 *
 * A settings pane declares its title via useSettingsPaneTitle; the
 * SettingsLayout renders it in the top header strip (as the breadcrumb's
 * current segment), never inside the scrollable pane content. One title,
 * one location — the content area holds settings only, no repeated heading.
 */
const SettingsPaneTitleContext = createContext<
  ((title: string | null) => void) | null
>(null);

export const SettingsPaneTitleProvider = SettingsPaneTitleContext.Provider;

/**
 * Register this pane's header title with the settings layout. Pass the
 * already-translated title string; it updates whenever the string changes.
 */
export function useSettingsPaneTitle(title: string): void {
  const register = useContext(SettingsPaneTitleContext);
  useEffect(() => {
    if (!register) return;
    register(title);
    return () => register(null);
  }, [register, title]);
}

/** Layout-side state holder for the active pane's title. */
export function useSettingsPaneTitleRegistration(): {
  title: string | null;
  setTitle: (title: string | null) => void;
} {
  const [title, setTitle] = useState<string | null>(null);
  return { title, setTitle };
}
