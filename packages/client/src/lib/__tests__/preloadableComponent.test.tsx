import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { preloadableComponent } from "../preloadableComponent";

describe("preloadable route components", () => {
  it("renders preloaded controls on the first commit without a fallback", async () => {
    const load = vi.fn(async () => ({
      default: ({ label }: { label: string }) => (
        <button type="button">{label}</button>
      ),
    }));
    const Controls = preloadableComponent(load);
    await Controls.preload();
    await Controls.preload();
    const fallback = vi.fn(() => <p>Loading</p>);
    const Fallback = fallback;
    render(
      <Suspense fallback={<Fallback />}>
        <Controls label="Ready" />
      </Suspense>,
    );
    expect(screen.getByRole("button", { name: "Ready" })).toBeTruthy();
    expect(fallback).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retains lazy loading when the route was not preloaded", async () => {
    const Controls = preloadableComponent(async () => ({
      default: () => <button type="button">Ready</button>,
    }));
    render(
      <Suspense fallback={<p>Loading</p>}>
        <Controls />
      </Suspense>,
    );
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Ready" })).toBeTruthy();
  });

  it("preserves a failed preload for the route error boundary", async () => {
    const error = new Error("Module unavailable");
    const load = vi.fn(() => Promise.reject(error));
    const Controls = preloadableComponent(load);
    await expect(Controls.preload()).rejects.toBe(error);
    expect(() => Controls({})).toThrow(error);
    await expect(Controls.preload()).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
