import {
  type BottomOverscrollReloadStatus,
  useBottomOverscrollReload,
} from "../hooks/useBottomOverscrollReload";

interface BottomOverscrollReloadProps {
  onReload: () => void;
}

function getLabel(status: BottomOverscrollReloadStatus): string {
  return status === "armed" ? "Release to reload" : "Pull up to reload";
}

export function BottomOverscrollReload({
  onReload,
}: BottomOverscrollReloadProps) {
  const status = useBottomOverscrollReload(onReload);

  if (status === "hidden") {
    return null;
  }

  return (
    <div
      className={`bottom-overscroll-reload bottom-overscroll-reload--${status}`}
      aria-live="polite"
    >
      {getLabel(status)}
    </div>
  );
}
