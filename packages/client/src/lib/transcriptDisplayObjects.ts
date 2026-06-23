import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import type { RenderItem } from "../types/renderItems";

export function insertTranscriptDisplayObjects(
  items: RenderItem[],
  objects: readonly TranscriptDisplayObject[],
): RenderItem[] {
  if (objects.length === 0) {
    return items;
  }

  const placements = objects.flatMap((object, order) => {
    let itemIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (
        item?.sourceMessages.some(
          (message) =>
            (message.uuid ?? message.id) === object.placementAfterMessageId,
        )
      ) {
        itemIndex = index;
      }
    }
    return itemIndex < 0 ? [] : [{ itemIndex, object, order }];
  });
  placements.sort(
    (left, right) =>
      right.itemIndex - left.itemIndex || right.order - left.order,
  );
  if (placements.length === 0) {
    return items;
  }

  const result = [...items];
  for (const placement of placements) {
    result.splice(placement.itemIndex + 1, 0, {
      type: "transcript_display_object",
      id: placement.object.id,
      object: placement.object,
      sourceMessages: [],
    });
  }
  return result;
}
