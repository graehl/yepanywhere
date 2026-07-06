import { sanitizeSessionTitle } from "@yep-anywhere/shared";
import { getSessionDisplayTitle } from "../utils";

interface SessionTitleSource {
  customTitle?: string;
  fullTitle?: string | null;
  title?: string | null;
}

export interface SessionPageTitleState {
  sessionTitle: string;
  headerAutoTitle: string | null;
  displayTitle: string;
  titleTooltip: string;
}

export function resolveSessionPageTitle({
  initialTitle,
  localCustomTitle,
  session,
  untitledTitle,
}: {
  initialTitle: string | undefined;
  localCustomTitle: string | undefined;
  session: SessionTitleSource | null | undefined;
  untitledTitle: string;
}): SessionPageTitleState {
  const sessionTitle = getSessionDisplayTitle(session);
  const headerAutoTitle =
    !session?.customTitle && session?.fullTitle
      ? sanitizeSessionTitle(session.fullTitle).slice(0, 600).trimEnd()
      : null;
  const displayTitle =
    localCustomTitle ??
    headerAutoTitle ??
    (sessionTitle !== "Untitled" ? sessionTitle : null) ??
    initialTitle ??
    untitledTitle;
  const titleTooltip =
    localCustomTitle ??
    session?.customTitle ??
    session?.fullTitle ??
    displayTitle;

  return {
    sessionTitle,
    headerAutoTitle,
    displayTitle,
    titleTooltip,
  };
}

export function createSessionRetitleSubmittedTurnText(
  currentTitle: string,
  lengthTarget: number,
): string {
  const title = currentTitle.trim();
  return [
    "What is a good new title for this session?",
    "",
    `Target length: under ${lengthTarget} characters.`,
    title ? `Current title: ${title}` : undefined,
    "Prefer a concrete task/result phrase over a generic chat title.",
    "Return only the title. Do not quote it. Do not add a trailing period.",
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

export interface GeneratedRetitleInsertion {
  prefix: string;
  suffix: string;
}

export function composeGeneratedRetitle(
  title: string,
  insertion: GeneratedRetitleInsertion,
): string {
  return `${insertion.prefix}${title}${insertion.suffix}`;
}
