import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useRetainSidebarSessionFeeds: vi.fn(),
  Sidebar: vi.fn(({ isDesktop }: { isDesktop?: boolean }) => (
    <div data-testid={isDesktop ? "desktop-sidebar" : "mobile-sidebar"} />
  )),
}));

vi.mock("../../components/Sidebar", () => ({
  Sidebar: mocks.Sidebar,
}));

vi.mock("../../hooks/useSidebarSessionFeeds", () => ({
  useRetainSidebarSessionFeeds: mocks.useRetainSidebarSessionFeeds,
}));

import { NavigationLayout } from "../NavigationLayout";

function renderNavigationLayout(path = "/agents") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<NavigationLayout />}>
          <Route path="/agents" element={<div data-testid="route-content" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("NavigationLayout", () => {
  beforeEach(() => {
    mocks.useRetainSidebarSessionFeeds.mockClear();
    mocks.Sidebar.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("mounts sidebar session coverage from the app shell", () => {
    renderNavigationLayout();

    expect(screen.getByTestId("route-content")).toBeTruthy();
    expect(mocks.useRetainSidebarSessionFeeds).toHaveBeenCalledTimes(1);
  });
});
