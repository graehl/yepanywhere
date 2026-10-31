import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { ImageViewer } from "./ImageViewer";
import { Modal } from "./ui/Modal";

/** Reviewed renderer output, never arbitrary uploaded SVG. */
export default function DiagramViewer({
  svg,
  onClose,
}: {
  svg: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [svg]);

  return (
    <Modal
      title={t("diagramViewerTitle")}
      variant="image-viewer"
      onClose={onClose}
      closeOnBackGesture
      closeOnBackspace
    >
      {url ? <ImageViewer url={url} fileName="diagram.svg" vector /> : null}
    </Modal>
  );
}
