import { useEmulators } from "../../hooks/useEmulators";

/**
 * Settings section for Android emulator bridge.
 * Shows discovered emulators and their status.
 */
export function EmulatorSettings() {
  const { emulators, loading, error, startEmulator, stopEmulator } =
    useEmulators();

  return (
    <section className="settings-section">
      <h2>Android Emulator</h2>
      <p className="settings-description">
        Stream and control Android emulators from your phone via WebRTC.
      </p>

      <div className="settings-group">
        <h3>Discovered Emulators</h3>

        {loading && <p className="settings-muted">Loading...</p>}
        {error && <p className="settings-error">{error}</p>}

        {!loading && emulators.length === 0 && (
          <p className="settings-muted">
            No emulators found. Ensure ADB is on your PATH and emulators are
            available.
          </p>
        )}

        {emulators.map((emu) => (
          <div key={emu.id} className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{emu.avd}</span>
              <span className="settings-item-description">
                {emu.id} &mdash; {emu.state}
              </span>
            </div>
            <div className="settings-item-action">
              {emu.state === "running" ? (
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={() => stopEmulator(emu.id)}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={() => startEmulator(emu.id)}
                >
                  Start
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
