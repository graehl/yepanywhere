import { useI18n } from "../i18n";
import { useTextTooltipAttributes } from "../hooks/useTooltipAppearance";
import { LinkifiedText } from "./ui/LinkifiedText";
import styles from "./GoalNotice.module.css";

export function GoalNotice({
  objective,
  status,
}: {
  objective: string;
  status?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.notice} title={status}>
      <strong className={styles.label}>{t("goalNoticeLabel")}</strong>
      <span className={styles.objective}>
        <LinkifiedText text={objective} />
      </span>
    </div>
  );
}

export function GoalFlag({ objective }: { objective: string }) {
  const { t } = useI18n();
  const tooltip = useTextTooltipAttributes(objective);
  return (
    <button
      type="button"
      className={styles.flag}
      {...tooltip}
      aria-label={t("goalFlagLabel", { objective })}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        aria-hidden="true"
      >
        <path d="M5 21V4m0 0c5-5 9 5 14 0v10c-5 5-9-5-14 0" />
      </svg>
    </button>
  );
}
