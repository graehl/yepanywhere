import type {
  BusyComposerDefaultAction,
  CollapsedComposerButtonPreference,
  ToolbarNarrowingPriority,
} from "@yep-anywhere/shared";
import { useCallback, useMemo, useState } from "react";
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

type ToolbarSide = "left" | "right";

interface ToolbarControlMeta {
  key: SessionToolbarVisibilityKey;
  title: string;
  description: string;
  side: ToolbarSide;
  canSetPriority: boolean;
}

const PRIORITY_EDITABLE_CONTROLS = new Set<SessionToolbarVisibilityKey>([
  "modeSelector",
  "attachments",
  "slashMenu",
  "thinkingToggle",
  "renderMode",
  "nudge",
  "sessionStatus",
  "shortcutsHelp",
  "contextUsage",
  "btw",
  "steerNow",
  "projectQueue",
]);

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
  const [placementVisibility] = useState(() => ({ ...toolbarVisibility }));
  const [activeControlKey, setActiveControlKey] =
    useState<SessionToolbarVisibilityKey | null>(null);
  const { settings, error, updateSettings } = useServerSettings();
  const { version } = useVersion();
  const supportsProjectQueue = serverSupportsProjectQueue(version);

  const busyComposerDefaultAction =
    settings?.clientDefaults?.busyComposerDefaultAction ?? "steer";
  const collapsedComposerButton =
    settings?.clientDefaults?.collapsedComposerButton ?? "primary";

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

  const controlMeta = (
    key: SessionToolbarVisibilityKey,
    title: string,
    description: string,
    side: ToolbarSide,
  ): ToolbarControlMeta => ({
    key,
    title,
    description,
    side,
    canSetPriority: PRIORITY_EDITABLE_CONTROLS.has(key),
  });

  const toolbarControls: ToolbarControlMeta[] = [
    controlMeta(
      "modeSelector",
      t("appearanceToolbarModeTitle"),
      t("appearanceToolbarModeDescription"),
      "left",
    ),
    controlMeta(
      "attachments",
      t("appearanceToolbarAttachmentsTitle"),
      t("appearanceToolbarAttachmentsDescription"),
      "left",
    ),
    controlMeta(
      "slashMenu",
      t("appearanceToolbarSlashTitle"),
      t("appearanceToolbarSlashDescription"),
      "left",
    ),
    controlMeta(
      "thinkingToggle",
      t("appearanceToolbarThinkingTitle"),
      t("appearanceToolbarThinkingDescription"),
      "left",
    ),
    controlMeta(
      "renderMode",
      t("appearanceToolbarRenderModeTitle"),
      t("appearanceToolbarRenderModeDescription"),
      "left",
    ),
    controlMeta(
      "nudge",
      t("appearanceToolbarNudgeTitle"),
      t("appearanceToolbarNudgeDescription"),
      "left",
    ),
    controlMeta(
      "microphone",
      t("appearanceToolbarMicrophoneTitle"),
      t("appearanceToolbarMicrophoneDescription"),
      "left",
    ),
    controlMeta(
      "waveform",
      t("appearanceToolbarWaveformTitle"),
      t("appearanceToolbarWaveformDescription"),
      "left",
    ),
    controlMeta(
      "sessionStatus",
      t("appearanceToolbarStatusTitle"),
      t("appearanceToolbarStatusDescription"),
      "right",
    ),
    controlMeta(
      "shortcutsHelp",
      t("appearanceToolbarShortcutsTitle"),
      t("appearanceToolbarShortcutsDescription"),
      "right",
    ),
    controlMeta(
      "contextUsage",
      t("appearanceToolbarContextTitle"),
      t("appearanceToolbarContextDescription"),
      "right",
    ),
    controlMeta(
      "btw",
      t("appearanceToolbarBtwTitle"),
      t("appearanceToolbarBtwDescription"),
      "right",
    ),
    controlMeta(
      "steerNow",
      t("appearanceToolbarSteerNowTitle"),
      t("appearanceToolbarSteerNowDescription"),
      "right",
    ),
  ];
  if (supportsProjectQueue) {
    toolbarControls.push(
      controlMeta(
        "projectQueue",
        t("appearanceToolbarProjectQueueTitle"),
        t("appearanceToolbarProjectQueueDescription"),
        "right",
      ),
    );
  }

  const hiddenLeft = toolbarControls.filter(
    (control) => !placementVisibility[control.key] && control.side === "left",
  );
  const hiddenRight = toolbarControls.filter(
    (control) => !placementVisibility[control.key] && control.side === "right",
  );
  const shownControls = toolbarControls.filter(
    (control) => placementVisibility[control.key],
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

  const renderPriorityControls = (control: ToolbarControlMeta) => {
    if (!control.canSetPriority) return null;
    return (
      <span
        className="session-toolbar-priority"
        role="radiogroup"
        aria-label={t("appearanceToolbarPriorityAria", {
          control: control.title,
        })}
      >
        {priorityOptions.map((option) => {
          const selected = toolbarPriority[control.key] === option.value;
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
              onClick={() => setControlPriority(control.key, option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </span>
    );
  };

  const renderVisibilityButton = (control: ToolbarControlMeta) => {
    const isVisible = toolbarVisibility[control.key];
    const label = isVisible
      ? t("appearanceToolbarHide")
      : t("appearanceToolbarShowControl", { control: control.title });
    return (
      <button
        type="button"
        className={`session-toolbar-hide-button${
          isVisible ? "" : " is-show-action"
        }`}
        onClick={() => setControlVisible(control.key, !isVisible)}
        title={label}
        aria-label={label}
      >
        {isVisible ? "×" : t("appearanceToolbarShow")}
      </button>
    );
  };

  const renderControlMenu = (control: ToolbarControlMeta) => {
    if (activeControlKey !== control.key) return null;
    return (
      <div
        className="session-toolbar-control-menu"
        role="dialog"
        aria-label={t("appearanceToolbarControlMenu", {
          control: control.title,
        })}
      >
        {renderPriorityControls(control)}
        {renderVisibilityButton(control)}
      </div>
    );
  };

  const renderControlRow = (
    control: ToolbarControlMeta,
    placement: "hidden" | "shown",
  ) => (
    <div
      className={`session-toolbar-control-row is-${placement} ${
        toolbarVisibility[control.key]
          ? "is-currently-shown"
          : "is-currently-hidden"
      }`}
      key={control.key}
    >
      <span className="session-toolbar-control-preview-cell">
        <ToolbarControlPreview
          activationLabel={t("appearanceToolbarActivateControl", {
            control: control.title,
          })}
          controlKey={control.key}
          onActivate={() =>
            setActiveControlKey((current) =>
              current === control.key ? null : control.key,
            )
          }
        />
      </span>
      <span className="session-toolbar-control-copy">
        <strong>{control.title}</strong>
        <span>{control.description}</span>
      </span>
      <span className="session-toolbar-control-actions">
        {renderPriorityControls(control)}
        {renderVisibilityButton(control)}
      </span>
      {renderControlMenu(control)}
    </div>
  );

  const renderHiddenGroup = (label: string, controls: ToolbarControlMeta[]) => (
    <div className="session-toolbar-hidden-group">
      <div className="session-toolbar-hidden-group-title">{label}</div>
      {controls.length === 0 ? (
        <p className="session-toolbar-hidden-empty">
          {t("appearanceToolbarSideNoneHidden")}
        </p>
      ) : (
        controls.map((control) => renderControlRow(control, "hidden"))
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
              {shownControls.map((control) => renderControlRow(control, "shown"))}
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
