export function toSourceTransportApiPath(path: string): string {
  if (path === "/api") {
    return "/";
  }
  if (path.startsWith("/api/")) {
    return path.slice("/api".length);
  }
  return path;
}
