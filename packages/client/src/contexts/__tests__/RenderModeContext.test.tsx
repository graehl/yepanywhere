import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RenderModeProvider,
  useOptionalRenderModeContext,
} from "../RenderModeContext";
import { FixedFontMathToggle } from "../../components/ui/FixedFontMathToggle";

function GlobalControls() {
  const renderMode = useOptionalRenderModeContext();

  if (!renderMode) {
    return null;
  }

  return (
    <div>
      <span data-testid="global-state">{renderMode.state}</span>
      <button type="button" onClick={renderMode.toggleGlobalMode}>
        Toggle global
      </button>
    </div>
  );
}

function MathPane({
  id,
  sourceText,
}: {
  id: string;
  sourceText: string;
}) {
  return (
    <div data-testid={id}>
      <FixedFontMathToggle
        sourceText={sourceText}
        sourceView={<pre data-testid={`${id}-source`}>{sourceText}</pre>}
        renderRenderedView={(html) => (
          <div
            data-testid={`${id}-rendered`}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: test harness mirrors production KaTeX rendering
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      />
    </div>
  );
}

describe("RenderModeProvider", () => {
  afterEach(() => {
    cleanup();
  });

  it("tracks mixed local overrides and clears them when toggled globally", () => {
    render(
      <RenderModeProvider>
        <GlobalControls />
        <MathPane id="first" sourceText={"alpha $x^2$ omega"} />
      </RenderModeProvider>,
    );

    expect(screen.getByTestId("global-state").textContent).toBe("rendered");
    expect(screen.getByTestId("first-rendered")).toBeDefined();

    fireEvent.click(
      within(screen.getByTestId("first")).getByRole("button", {
        name: "Show source",
      }),
    );

    expect(screen.getByTestId("global-state").textContent).toBe("mixed");
    expect(screen.getByTestId("first-source")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Toggle global" }));

    expect(screen.getByTestId("global-state").textContent).toBe("source");
    expect(screen.getByTestId("first-source")).toBeDefined();
  });

  it("lets fresh panes follow the base mode even while existing ones are mixed", () => {
    const view = render(
      <RenderModeProvider>
        <GlobalControls />
        <MathPane id="first" sourceText={"alpha $x^2$ omega"} />
      </RenderModeProvider>,
    );

    fireEvent.click(
      within(screen.getByTestId("first")).getByRole("button", {
        name: "Show source",
      }),
    );

    expect(screen.getByTestId("global-state").textContent).toBe("mixed");

    view.rerender(
      <RenderModeProvider>
        <GlobalControls />
        <MathPane id="first" sourceText={"alpha $x^2$ omega"} />
        <MathPane id="second" sourceText={"beta $y^2$ gamma"} />
      </RenderModeProvider>,
    );

    expect(screen.getByTestId("global-state").textContent).toBe("mixed");
    expect(screen.getByTestId("first-source")).toBeDefined();
    expect(screen.getByTestId("second-rendered")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Toggle global" }));

    expect(screen.getByTestId("global-state").textContent).toBe("source");

    view.rerender(
      <RenderModeProvider>
        <GlobalControls />
        <MathPane id="first" sourceText={"alpha $x^2$ omega"} />
        <MathPane id="second" sourceText={"beta $y^2$ gamma"} />
        <MathPane id="third" sourceText={"delta $z^2$ epsilon"} />
      </RenderModeProvider>,
    );

    expect(screen.getByTestId("third-source")).toBeDefined();
  });

  it("supports the session hotkey and clears local overrides incrementally", () => {
    render(
      <RenderModeProvider>
        <GlobalControls />
        <MathPane id="first" sourceText={"alpha $x^2$ omega"} />
      </RenderModeProvider>,
    );

    fireEvent.click(
      within(screen.getByTestId("first")).getByRole("button", {
        name: "Show source",
      }),
    );

    expect(screen.getByTestId("global-state").textContent).toBe("mixed");

    fireEvent.keyDown(window, {
      key: "M",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(screen.getByTestId("global-state").textContent).toBe("source");
    expect(screen.getByTestId("first-source")).toBeDefined();

    fireEvent.keyDown(window, {
      key: "M",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(screen.getByTestId("global-state").textContent).toBe("rendered");
    expect(screen.getByTestId("first-rendered")).toBeDefined();
  });
});
