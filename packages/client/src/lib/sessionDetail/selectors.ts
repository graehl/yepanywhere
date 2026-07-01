import type {
  ActiveToolApproval,
  PreprocessAugments,
} from "../preprocessMessages";
import type { SessionDetailState } from "./types";

export function selectSessionDetailPreprocessAugments(
  state: SessionDetailState,
  options: { activeToolApproval?: ActiveToolApproval } = {},
): PreprocessAugments | undefined {
  const hasMarkdownAugments = Object.keys(state.markdownAugments).length > 0;
  if (!hasMarkdownAugments && options.activeToolApproval === undefined) {
    return undefined;
  }

  return {
    ...(hasMarkdownAugments && { markdown: state.markdownAugments }),
    ...(options.activeToolApproval !== undefined && {
      activeToolApproval: options.activeToolApproval,
    }),
  };
}
