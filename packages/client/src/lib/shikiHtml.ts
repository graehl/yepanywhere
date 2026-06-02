export function compactShikiLineBreaks(
  html: string | undefined,
): string | undefined {
  if (!html) {
    return html;
  }
  return html.replace(/<\/span>\r?\n(?=<span class="line(?:\s|"))/g, "</span>");
}
