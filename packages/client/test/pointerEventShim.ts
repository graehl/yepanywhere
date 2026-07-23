// jsdom does not currently implement PointerEvent. Testing Library otherwise
// falls back to a plain Event and silently drops coordinates and pointerType,
// making pointer-intent tests pass or fail for the wrong reason.
if (
  typeof window !== "undefined" &&
  typeof window.PointerEvent === "undefined"
) {
  class TestPointerEvent extends MouseEvent {
    readonly pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  }

  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: TestPointerEvent,
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: TestPointerEvent,
  });
}
