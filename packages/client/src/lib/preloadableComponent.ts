import { createElement, type ComponentType } from "react";

/** Preloaded components render synchronously instead of committing a loading fallback. */
export function preloadableComponent<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  let result:
    | { status: "ready"; component: ComponentType<Props> }
    | { status: "failed"; error: unknown }
    | undefined;
  let promise: Promise<void> | undefined;

  function preload(): Promise<void> {
    promise ??= load().then(
      (module) => {
        result = { status: "ready", component: module.default };
      },
      (error: unknown) => {
        result = { status: "failed", error };
        throw error;
      },
    );
    return promise;
  }

  function PreloadableComponent(props: Props) {
    if (result?.status === "ready")
      return createElement(result.component, props);
    if (result?.status === "failed") throw result.error;
    throw preload();
  }

  return Object.assign(PreloadableComponent, { preload });
}
