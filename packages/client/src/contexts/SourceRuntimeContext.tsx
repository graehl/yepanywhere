import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  getSourceRuntimeRegistry,
  type YaSourceRuntime,
} from "../lib/sourceRuntime";

const SourceRuntimeContext = createContext<YaSourceRuntime | null>(null);

interface SourceRuntimeProviderProps {
  children: ReactNode;
  runtime: YaSourceRuntime;
}

export function SourceRuntimeProvider({
  children,
  runtime,
}: SourceRuntimeProviderProps) {
  return (
    <SourceRuntimeContext.Provider value={runtime}>
      {children}
    </SourceRuntimeContext.Provider>
  );
}

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
  const runtime = useContext(SourceRuntimeContext);
  const fallbackSourceKey = useClientSummarySourceKey();
  return (
    runtime ??
    getSourceRuntimeRegistry().getOrCreateSourceRuntime(fallbackSourceKey)
  );
}
