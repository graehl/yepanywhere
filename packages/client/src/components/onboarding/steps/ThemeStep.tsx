import { getThemeLabel, THEMES, useTheme } from "../../../hooks/useTheme";
import { useI18n } from "../../../i18n";
import type { OnboardingStepProps } from "../types";

/**
 * Onboarding step for selecting a theme.
 * Shows visual previews of each theme option.
 */
export function ThemeStep({ onNext, onSkip, isLastStep }: OnboardingStepProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div className="onboarding-step-content">
      <p className="onboarding-step-description">
        {t("onboardingThemeDescription")}
      </p>

      <div className="onboarding-theme-grid">
        {THEMES.map((themeName) => (
          <button
            key={themeName}
            type="button"
            className={`onboarding-theme-option ${theme === themeName ? "selected" : ""}`}
            onClick={() => setTheme(themeName)}
          >
            <div
              className={`onboarding-theme-preview theme-preview-${themeName}`}
            />
            <span className="onboarding-theme-label">
              {getThemeLabel(themeName)}
            </span>
          </button>
        ))}
      </div>

      <div className="onboarding-step-actions">
        <button type="button" className="btn-secondary" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          {isLastStep ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
