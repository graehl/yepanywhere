import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectPathLinkTarget } from "@yep-anywhere/shared";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useAsyncQuestions } from "../contexts/AsyncQuestionsContext";
import { isQuestionAnswered } from "../lib/asyncQuestionRecords";
import { useI18n } from "../i18n";
import type { AsyncQuestion } from "../lib/asyncQuestions";
import styles from "./AsyncQuestions.module.css";
import { MarkdownPreview } from "./MarkdownPreview";
import { renderFixedFontRichContent } from "./ui/FixedFontMathToggle";

function InlineQuestion({
  question,
  projectPathLinks,
}: {
  question: AsyncQuestion;
  projectPathLinks?: readonly ProjectPathLinkTarget[];
}) {
  const state = useAsyncQuestions()!;
  const { t } = useI18n();
  const sessionMetadata = useOptionalSessionMetadata();
  const publicShare = usePublicShareContext();
  const basePath = useRemoteBasePath();
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const record = state.records[question.id];
  const active = state.activeId === question.id;
  const busy = state.submittingId === question.id;
  const answered = isQuestionAnswered(record);
  const update = state.update;
  const titleHtml = useMemo(
    () =>
      renderFixedFontRichContent(question.title, {
        diffAware: false,
        linkifyUrls: true,
        projectId:
          sessionMetadata?.projectId ?? publicShare?.projectId ?? undefined,
        projectPath: sessionMetadata?.projectPath ?? undefined,
        basePath,
        publicShare,
        projectPathLinks,
      }).html,
    [
      question.title,
      sessionMetadata?.projectId,
      sessionMetadata?.projectPath,
      basePath,
      publicShare,
      projectPathLinks,
    ],
  );
  useEffect(() => {
    if (record?.seen || !root.current) return;
    let visible = false;
    const markSeen = () => {
      if (visible && !document.hidden) update(question.id, { seen: true });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = (entry?.intersectionRatio ?? 0) >= 0.6;
        markSeen();
      },
      { threshold: 0.6 },
    );
    observer.observe(root.current);
    document.addEventListener("visibilitychange", markSeen);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", markSeen);
    };
  }, [question.id, record?.seen, update]);
  const send = async (answer: string) => {
    setError(false);
    try {
      if (!(await state.submit(question, answer))) setError(true);
    } catch {
      setError(true);
    }
  };
  return (
    <div
      className={`${styles.inlineQuestion} ${active ? styles.activeQuestion : ""}`}
      data-async-question-reply={question.id}
    >
      <div ref={root}>
        <MarkdownPreview className={styles.questionTitle} html={titleHtml} />
      </div>
      {question.options.length > 0 && (
        <>
          <p className={styles.hint}>{t("asyncQuestionClickToSend")}</p>
          <ul className={styles.options}>
            {question.options.map((option, index) => (
              <li key={`${index}:${option}`}>
                <button
                  type="button"
                  disabled={busy || answered}
                  onClick={() => void send(option)}
                >
                  <span aria-hidden="true">•</span>
                  <span>{option}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {answered ? (
        <p className={styles.sent}>
          {record?.quoted
            ? t("asyncQuestionReplyQuoted")
            : t("asyncQuestionReplySent", { answer: record!.answer! })}
        </p>
      ) : (
        <>
          {!active && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => state.open(question)}
            >
              {t("asyncQuestionReply")}
            </button>
          )}
          {active && (
            <form
              className={styles.replyForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !record?.draft.trim()) return;
                void send(record?.draft ?? "");
              }}
            >
              <textarea
                rows={3}
                value={record?.draft ?? ""}
                aria-label={t("asyncQuestionReplyTo", {
                  question: question.title,
                })}
                placeholder={t("asyncQuestionReplyPlaceholder")}
                readOnly={busy}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing ||
                    event.keyCode === 229
                  )
                    return;
                  event.preventDefault();
                  if (!event.repeat) event.currentTarget.form?.requestSubmit();
                }}
                onChange={(event) =>
                  update(question.id, { draft: event.target.value })
                }
              />
              <div className={styles.replyActions}>
                <button
                  type="button"
                  className={`${styles.secondary} ${styles.iconAction}`}
                  onClick={state.returnToPrevious}
                  aria-label={t("asyncQuestionBack")}
                  title={t("asyncQuestionBack")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m10 5-7 7 7 7M3 12h18" />
                  </svg>
                </button>
                <button
                  type="submit"
                  className={styles.send}
                  disabled={busy || !record?.draft.trim()}
                >
                  {t(busy ? "asyncQuestionSending" : "asyncQuestionSend")}
                </button>
              </div>
            </form>
          )}
          <button
            type="button"
            className={`${styles.secondary} ${styles.iconAction}`}
            onClick={() => state.quote(question)}
            aria-label={t("asyncQuestionQuoteMain")}
            title={t("asyncQuestionQuoteMain")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="m10 8 4 4-4 4" />
            </svg>
          </button>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {t("asyncQuestionSendFailed")}
        </p>
      )}
    </div>
  );
}

export function AsyncQuestionMessage({
  renderId,
  projectPathLinks,
  fallback,
}: {
  renderId: string;
  projectPathLinks?: readonly ProjectPathLinkTarget[];
  fallback: ReactNode;
}) {
  const state = useAsyncQuestions();
  const questions =
    state?.questions.filter((question) => question.renderId === renderId) ?? [];
  if (!questions.length) return fallback;
  return (
    <>
      {questions.map((question) => (
        <InlineQuestion
          key={question.id}
          question={question}
          projectPathLinks={projectPathLinks}
        />
      ))}
    </>
  );
}
