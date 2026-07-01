import type {
  BusyComposerDefaultAction,
  CollapsedComposerButtonPreference,
  ToolbarNarrowingPriority,
} from "@yep-anywhere/shared";
import { useCallback, useMemo } from "react";
import {
  SessionToolbarPreview,
  ToolbarControlPreview,
} from "../../components/SessionToolbarPreview";
import { useSessionToolbarPriority } from "../../hooks/useSessionToolbarPriority";
import {
  type SessionToolbarVisibilityKey,
  useSessionToolbarVisibility,
} from "../../hooks/useSessionToolbarVisibility";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { serverSupportsProjectQueue } from "../../lib/projectQueueVisibility";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";

const BUSY_COMPOSER_DEFAULT_ACTIONS: BusyComposerDefaultAction[] = [
  "steer",
  "queue",
];

const COLLAPSED_COMPOSER_BUTTON_OPTIONS: CollapsedComposerButtonPreference[] = [
  "primary",
  "alternate",
  "microphone",
];

// Which toolbar edge a control lives on, for the hidden-zone two-column split.
type ToolbarSide = "left" | "right";

interface ToolbarControlMeta {
  key: SessionToolbarVisibilityKey;
  title: string;
  description: string;
  side: ToolbarSide;
}

export function ToolbarSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("appearanceSessionToolbarTitle"));
  const {
    visibility: toolbarVisibility,
    setControlVisible,
    resetVisibility,
  } = useSessionToolbarVisibility();
  const {
    priority: toolbarPriority,
    setControlPriority,
    resetPriority,
  } = useSessionToolbarPriority();
  const { settings, error, updateSettings } = useServerSettings();
  const { version } = useVersion();
  const supportsProjectQueue = serverSupportsProjectQueue(version);

  const busyComposerDefaultAction =
    settings?.clientDefaults?.busyComposerDefaultAction ?? "steer";
  const collapsedComposerButton =
    settings?.clientDefaults?.collapsedComposerButton ?? "primary";

  // Header undo: snapshot visibility + priority at pane open.
  const undoState = useMemo(
    () =>
      settings
        ? {
            toolbarVisibility,
            toolbarPriority,
            busyComposerDefaultAction,
            collapsedComposerButton,
          }
        : null,
    [
      busyComposerDefaultAction,
      collapsedComposerButton,
      settings,
      toolbarPriority,
      toolbarVisibility,
    ],
  );
  const restoreUndoState = useCallback(
    (snapshot: typeof undoState) => {
      if (!snapshot) return;
      for (const [key, visible] of Object.entries(snapshot.toolbarVisibility)) {
        setControlVisible(key as SessionToolbarVisibilityKey, visible);
      }
      for (const [key, value] of Object.entries(snapshot.toolbarPriority)) {
        setControlPriority(key as SessionToolbarVisibilityKey, value);
      }
      void updateSettings({
        clientDefaults: {
          busyComposerDefaultAction: snapshot.busyComposerDefaultAction,
          collapsedComposerButton: snapshot.collapsedComposerButton,
        },
      }).catch(() => {
        // surfaced via the hook's error state
      });
    },
    [setControlPriority, setControlVisible, updateSettings],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  // Left-to-right toolbar order, annotated with the edge each control sits on.
  const toolbarControls: ToolbarControlMeta[] = [
    {
      key: "modeSelector",
      title: t("appearanceToolbarModeTitle"),
      description: t("appearanceToolbarModeDescription"),
      side: "left",
    },
    {
      key: "attachments",
      title: t("appearanceToolbarAttachmentsTitle"),
      description: t("appearanceToolbarAttachmentsDescription"),
      side: "left",
    },
    {
      key: "slashMenu",
      title: t("appearanceToolbarSlashTitle"),
      description: t("appearanceToolbarSlashDescription"),
      side: "left",
    },
    {
      key: "thinkingToggle",
      title: t("appearanceToolbarThinkingTitle"),
      description: t("appearanceToolbarThinkingDescription"),
      side: "left",
    },
    {
      key: "renderMode",
      title: t("appearanceToolbarRenderModeTitle"),
      description: t("appearanceToolbarRenderModeDescription"),
      side: "left",
    },
    {
      key: "nudge",
      title: t("appearanceToolbarNudgeTitle"),
      description: t("appearanceToolbarNudgeDescription"),
      side: "left",
    },
    {
      key: "microphone",
      title: t("appearanceToolbarMicrophoneTitle"),
      description: t("appearanceToolbarMicrophoneDescription"),
      side: "left",
    },
    {
      key: "waveform",
      title: t("appearanceToolbarWaveformTitle"),
      description: t("appearanceToolbarWaveformDescription"),
      side: "left",
    },
    {
      key: "sessionStatus",
      title: t("appearanceToolbarStatusTitle"),
      description: t("appearanceToolbarStatusDescription"),
      side: "right",
    },
    {
      key: "shortcutsHelp",
      title: t("appearanceToolbarShortcutsTitle"),
      description: t("appearanceToolbarShortcutsDescription"),
      side: "right",
    },
    {
      key: "contextUsage",
      title: t("appearanceToolbarContextTitle"),
      description: t("appearanceToolbarContextDescription"),
      side: "right",
    },
    {
      key: "btw",
      title: t("appearanceToolbarBtwTitle"),
      description: t("appearanceToolbarBtwDescription"),
      side: "right",
    },
    {
      key: "steerNow",
      title: t("appearanceToolbarSteerNowTitle"),
      description: t("appearanceToolbarSteerNowDescription"),
      side: "right",
    },
  ];
  if (supportsProjectQueue) {
    toolbarControls.push({
      key: "projectQueue",
      title: t("appearanceToolbarProjectQueueTitle"),
      description: t("appearanceToolbarProjectQueueDescription"),
      side: "right",
    });
  }

  const hiddenLeft = toolbarControls.filter(
    (control) => !toolbarVisibility[control.key] && control.side === "left",
  );
  const hiddenRight = toolbarControls.filter(
    (control) => !toolbarVisibility[control.key] && control.side === "right",
  );
  const shownControls = toolbarControls.filter(
    (control) => toolbarVisibility[control.key],
  );

  const priorityOptions: Array<{
    value: ToolbarNarrowingPriority;
    label: string;
    title: string;
  }> = [
    {
      value: "pin",
      label: t("appearanceToolbarPriorityPin"),
      title: t("appearanceToolbarPriorityPinTitle"),
    },
    {
      value: "last",
      label: t("appearanceToolbarPriorityLast"),
      title: t("appearanceToolbarPriorityLastTitle"),
    },
    {
      value: "mid",
      label: t("appearanceToolbarPriorityMid"),
      title: t("appearanceToolbarPriorityMidTitle"),
    },
    {
      value: "first",
      label: t("appearanceToolbarPriorityFirst"),
      title: t("appearanceToolbarPriorityFirstTitle"),
    },
  ];

  const renderHiddenGroup = (label: string, controls: ToolbarControlMeta[]) => (
    <div className="session-toolbar-hidden-group">
      <div className="session-toolbar-hidden-group-title">{label}</div>
      {controls.length === 0 ? (
        <p className="session-toolbar-hidden-empty">
          {t("appearanceToolbarSideNoneHidden")}
        </p>
      ) : (
        controls.map((control) => (
          // A div, not a label: the row contains the inert element preview
          // (which renders real toolbar controls), so a wrapping <label> would
          // associate with a control inside the preview instead of the toggle.
          // The toggle carries its own <label> so its slider stays clickable.
          <div
            className="session-toolbar-control-row is-hidden"
            key={control.key}
          >
            <span className="session-toolbar-control-preview-cell">
              <ToolbarControlPreview controlKey={control.key} />
            </span>
            <span className="session-toolbar-control-copy">
              <strong>{control.title}</strong>
              <span>{control.description}</span>
            </span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={false}
                onChange={() => setControlVisible(control.key, true)}
                aria-label={t("appearanceToolbarShowControl", {
                  control: control.title,
                })}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        ))
      )}
    </div>
  );

  return (
    <section className="settings-section">
      <p className="settings-section-description">
        {t("appearanceSessionToolbarDescription")}
      </p>

      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("appearanceToolbarDefaultActionTitle")}</strong>
            <p>{t("appearanceToolbarDefaultActionDescription")}</p>
          </div>
          <select
            className="settings-select"
            value={busyComposerDefaultAction}
            onChange={(event) => {
              const next = event.target.value as BusyComposerDefaultAction;
              if (!BUSY_COMPOSER_DEFAULT_ACTIONS.includes(next)) return;
              void updateSettings({
                clientDefaults: { busyComposerDefaultAction: next },
              }).catch(() => {
                // surfaced via the hook's error state
              });
            }}
            aria-label={t("appearanceToolbarDefaultActionTitle")}
          >
            <option value="steer">
              {t("appearanceToolbarDefaultActionSteer")}
            </option>
            <option value="queue">
              {t("appearanceToolbarDefaultActionQueue")}
            </option>
          </select>
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("appearanceToolbarCollapsedButtonTitle")}</strong>
            <p>{t("appearanceToolbarCollapsedButtonDescription")}</p>
          </div>
          <select
            className="settings-select"
            value={collapsedComposerButton}
            onChange={(event) => {
              const next = event.target
                .value as CollapsedComposerButtonPreference;
              if (!COLLAPSED_COMPOSER_BUTTON_OPTIONS.includes(next)) return;
              void updateSettings({
                clientDefaults: { collapsedComposerButton: next },
              }).catch(() => {
                // surfaced via the hook's error state
              });
            }}
            aria-label={t("appearanceToolbarCollapsedButtonTitle")}
          >
            <option value="primary">
              {t("appearanceToolbarCollapsedButtonPrimary")}
            </option>
            <option value="alternate">
              {t("appearanceToolbarCollapsedButtonAlternate")}
            </option>
            <option value="microphone">
              {t("appearanceToolbarCollapsedButtonMicrophone")}
            </option>
          </select>
        </div>

        <div className="settings-item session-toolbar-settings">
          <SessionToolbarPreview />

          <div className="session-toolbar-zone">
            <div className="session-toolbar-zone-heading">
              <strong>{t("appearanceToolbarHiddenHeading")}</strong>
              <span>{t("appearanceToolbarHiddenDescription")}</span>
            </div>
            <div className="session-toolbar-hidden-groups">
              {renderHiddenGroup(t("appearanceToolbarSideLeft"), hiddenLeft)}
              {renderHiddenGroup(t("appearanceToolbarSideRight"), hiddenRight)}
            </div>
          </div>

          <div className="session-toolbar-zone-separator" />

          <div className="session-toolbar-zone">
            <div className="session-toolbar-zone-heading">
              <strong>{t("appearanceToolbarShownHeading")}</strong>
              <span>{t("appearanceToolbarShownDescription")}</span>
            </div>
            <div className="session-toolbar-control-list">
              {shownControls.map((control) => (
                <div
                  className="session-toolbar-control-row is-shown"
                  key={control.key}
                >
                  <span className="session-toolbar-control-preview-cell">
                    <ToolbarControlPreview controlKey={control.key} />
                  </span>
                  <span className="session-toolbar-control-copy">
                    <strong>{control.title}</strong>
                    <span>{control.description}</span>
                  </span>
                  <span className="session-toolbar-control-actions">
                    <span
                      className="session-toolbar-priority"
                      role="radiogroup"
                      aria-label={t("appearanceToolbarPriorityAria", {
                        control: control.title,
                      })}
                    >
                      {priorityOptions.map((option) => {
                        const selected =
                          toolbarPriority[control.key] === option.value;
                        return (
                          <button
                            type="button"
                            key={option.value}
                            className={`session-toolbar-priority-option${
                              selected ? " is-selected" : ""
                            }`}
                            role="radio"
                            aria-checked={selected}
                            title={option.title}
                            onClick={() =>
                              setControlPriority(control.key, option.value)
                            }
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </span>
                    <button
                      type="button"
                      className="session-toolbar-hide-button"
                      onClick={() => setControlVisible(control.key, false)}
                      title={t("appearanceToolbarHide")}
                      aria-label={t("appearanceToolbarHide")}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-item-actions">
            <button
              type="button"
              className="settings-button settings-button-secondary"
              onClick={() => {
                resetVisibility();
                resetPriority();
              }}
            >
              {t("appearanceSessionToolbarReset")}
            </button>
          </div>
        </div>
        {error && <p className="settings-warning">{error}</p>}
      </div>
    </section>
  );
}
