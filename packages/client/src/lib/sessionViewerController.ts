import type { ReactNode, RefObject } from "react";
import { useSyncExternalStore } from "react";

interface SessionViewerBase {
  id: string;
  sessionId: string;
  label: string;
  briefLabel?: string;
}

export interface PanelViewerRegistration extends SessionViewerBase {
  kind: "panel";
  onClose: () => void;
  title: ReactNode;
  actions?: ReactNode;
  contentRef?: RefObject<HTMLDivElement | null>;
  content: ReactNode;
}

interface FileViewerBase extends SessionViewerBase {
  kind: "file";
  filePath: string;
  lineSuffix: string;
}

export type FileViewerRegistration = FileViewerBase &
  (
    | { onClose: () => void; renderContent?: never }
    | {
        onClose?: () => void;
        renderContent: (inactive: boolean) => ReactNode;
      }
  );

export type SessionViewerRegistration =
  | PanelViewerRegistration
  | FileViewerRegistration;

export type SessionViewerControllerState = SessionViewerRegistration & {
  close: () => void;
  minimize: () => void;
  minimized: boolean;
  restore: () => void;
};

let current: SessionViewerControllerState | null = null;
const listeners = new Set<() => void>();
let resumeRevision = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function openSessionId(
  state: SessionViewerControllerState | null,
): string | null {
  return state && !state.minimized ? state.sessionId : null;
}

function replaceCurrent(next: SessionViewerControllerState | null): void {
  const previousOpenSessionId = openSessionId(current);
  const nextOpenSessionId = openSessionId(next);
  if (previousOpenSessionId && previousOpenSessionId !== nextOpenSessionId) {
    resumeRevision += 1;
  }
  current = next;
  emit();
}

function closeViewer(id: string): void {
  if (current?.id !== id) return;
  const onClose = current.onClose;
  replaceCurrent(null);
  onClose?.();
}

function setMinimized(id: string, minimized: boolean): void {
  if (current?.id !== id || current.minimized === minimized) return;
  replaceCurrent({ ...current, minimized });
}

export function minimizeSessionViewer(id: string): void {
  setMinimized(id, true);
}

export function restoreSessionViewer(id: string): void {
  setMinimized(id, false);
}

function toController(
  registration: SessionViewerRegistration,
  minimized: boolean,
): SessionViewerControllerState {
  const { id } = registration;
  return {
    ...registration,
    close: () => closeViewer(id),
    minimize: () => setMinimized(id, true),
    minimized,
    restore: () => setMinimized(id, false),
  };
}

/**
 * Present or update the session's one managed viewer.
 *
 * Replacing a different viewer dismisses its source while an update to the
 * same viewer preserves its parked/open state and mounted host identity.
 */
export function presentSessionViewer(
  registration: SessionViewerRegistration,
): void {
  const previous = current;
  const minimized = previous?.id === registration.id && previous.minimized;
  replaceCurrent(toController(registration, Boolean(minimized)));
  if (previous && previous.id !== registration.id) previous.onClose?.();
}

export function clearSessionViewer(id: string): void {
  if (current?.id !== id) return;
  replaceCurrent(null);
}

export function clearCurrentSessionViewer(): void {
  if (!current) return;
  replaceCurrent(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionViewerControllerState | null {
  return current;
}

export function useSessionViewerController(): SessionViewerControllerState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isSessionViewerOpen(sessionId: string | null): boolean {
  return sessionId !== null && openSessionId(current) === sessionId;
}

/**
 * Notify transcript work only when a covering viewer stops being open.
 * Opening the viewer deliberately leaves the covered transcript unchanged.
 */
export function useSessionViewerResumeRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => resumeRevision,
    () => resumeRevision,
  );
}
