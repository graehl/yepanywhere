import { Fragment, memo, useMemo } from "react";
import { containsLinkifiableUrl, splitUrlSegments } from "../../lib/linkify";

interface Props {
  text: string;
  /** See SplitUrlSegmentsOptions.suppressTrailingUrl. */
  suppressTrailingUrl?: boolean;
}

/**
 * Plain text with bare URLs rendered as external links. Anchors stop click
 * propagation so row-level handlers (debug snapshot, chip jump targets) do
 * not also fire on a link click.
 */
export const LinkifiedText = memo(function LinkifiedText({
  text,
  suppressTrailingUrl,
}: Props) {
  const segments = useMemo(
    () =>
      containsLinkifiableUrl(text)
        ? splitUrlSegments(text, { suppressTrailingUrl })
        : null,
    [text, suppressTrailingUrl],
  );

  if (!segments?.some((segment) => segment.type === "url")) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "url" ? (
          <a
            key={`${index}-${segment.text}`}
            className="linkified-url"
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
});
