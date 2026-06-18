import { useI18n } from "../i18n";

interface Props {
  /** Cancel the in-flight transcription. A late result must become a no-op. */
  onCancel: () => void;
}

/**
 * Sibling status chip shown while a batch transcription is pending. The
 * pending transcription is never characters in the textarea value, so no
 * keystroke or backspace can disturb it; the explicit ✕ is the only way to
 * abandon it. See topics/mic-button-speech-ui.md (Batch Behavior).
 */
export function SpeechTranscribingChip({ onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="speech-transcribing-chip" role="status" aria-live="polite">
      <span className="speech-transcribing-spinner" aria-hidden="true" />
      <span className="speech-transcribing-label">
        {t("speechTranscribingPlaceholder" as never)}
      </span>
      <button
        type="button"
        className="speech-transcribing-cancel"
        onClick={onCancel}
        aria-label={t("speechTranscribingCancel" as never)}
        title={t("speechTranscribingCancel" as never)}
      >
        ×
      </button>
    </div>
  );
}
