import { type ReactNode, useMemo } from "react";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  SourceRuntimeProvider,
  useSourceRuntimeContextValue,
} from "../lib/sourceRuntimeReact";
import {
  getSourceRuntimeRegistry,
  type YaSourceRuntime,
} from "../lib/sourceRuntime";

export { SourceRuntimeProvider } from "../lib/sourceRuntimeReact";

interface CurrentSourceRuntimeProviderProps {
  children: ReactNode;
}

export function CurrentSourceRuntimeProvider({
  children,
}: CurrentSourceRuntimeProviderProps) {
  const sourceKey = useClientSummarySourceKey();
  const registry = getSourceRuntimeRegistry();
  const runtime = useMemo(
    () => registry.getOrCreateSourceRuntime(sourceKey),
    [registry, sourceKey],
  );
  return (
    <SourceRuntimeProvider runtime={runtime}>{children}</SourceRuntimeProvider>
  );
}

export function useCurrentSourceRuntime(): YaSourceRuntime {
  const runtime = useSourceRuntimeContextValue();
  const fallbackSourceKey = useClientSummarySourceKey();
  return (
    runtime ??
    getSourceRuntimeRegistry().getOrCreateSourceRuntime(fallbackSourceKey)
  );
}
