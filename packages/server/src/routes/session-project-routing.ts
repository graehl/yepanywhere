import { type UrlProjectId, isUrlProjectId } from "@yep-anywhere/shared";

/**
 * Decide whether a session request made under `requestProjectId` should be
 * redirected to a different canonical project.
 *
 * Two things can claim a session's canonical project:
 *  - an explicit `workingProjectId` pin (persisted metadata, set e.g. by the
 *    "move session to project" action), and
 *  - the project a live process is currently running the session under.
 *
 * The pin wins. When a pin is present we route to it and, once the request is
 * already AT the pin, we stop — we do NOT bounce to a live process running
 * under some other project. That bounce is what produced an infinite redirect
 * loop: with pin=A and an active process under B, a request for A redirected to
 * B (process rule), and a request for B redirected back to A (pin rule), so the
 * client ping-ponged forever and the session was unviewable. Only when there is
 * no pin does an active process's project become canonical (the session is
 * genuinely owned there).
 */
export function resolveCanonicalProjectRedirect(params: {
  requestProjectId: UrlProjectId;
  workingProjectId: UrlProjectId | undefined;
  activeProcessProjectId: string | undefined;
}): UrlProjectId | null {
  const { requestProjectId, workingProjectId, activeProcessProjectId } = params;

  if (workingProjectId) {
    return workingProjectId === requestProjectId ? null : workingProjectId;
  }

  if (
    typeof activeProcessProjectId === "string" &&
    isUrlProjectId(activeProcessProjectId) &&
    activeProcessProjectId !== requestProjectId
  ) {
    return activeProcessProjectId;
  }

  return null;
}
