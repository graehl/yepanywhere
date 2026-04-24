import { memo } from "react";
import { hasAnsiEscapes, renderAnsiToHtml } from "@yep-anywhere/shared";

interface Props {
  text: string;
  className?: string;
  as?: "code" | "span";
}

export const AnsiText = memo(function AnsiText({
  text,
  className,
  as = "code",
}: Props) {
  if (!hasAnsiEscapes(text)) {
    return as === "span" ? (
      <span className={className}>{text}</span>
    ) : (
      <code className={className}>{text}</code>
    );
  }

  const html = renderAnsiToHtml(text);
  return as === "span" ? (
    <span
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderAnsiToHtml escapes all payload text
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <code
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderAnsiToHtml escapes all payload text
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
