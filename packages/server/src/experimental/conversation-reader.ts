import {
  ConversationAcquisition,
  type ConversationReadOptions,
} from "./conversation-acquisition.js";
export {
  MAX_CONVERSATION_RECORD_BYTES,
  ConversationAcquisition,
} from "./conversation-acquisition.js";
// Fixed process-wide cache; bounded by ConversationAcquisition, with no timers.
const acquisition = new ConversationAcquisition();
export function readConversationFile(options: ConversationReadOptions) {
  return acquisition.read(options);
}
