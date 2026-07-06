import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";

export async function fetchJSON<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  return getSourceRuntimeRegistry()
    .getCurrentSourceRuntime()
    .transport.fetch<T>(path, options);
}
