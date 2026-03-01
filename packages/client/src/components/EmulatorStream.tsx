import { useEffect, useRef } from "react";

interface EmulatorStreamProps {
  /** Remote MediaStream from WebRTC */
  stream: MediaStream | null;
  /** WebRTC DataChannel for sending touch/key events */
  dataChannel: RTCDataChannel | null;
}

/**
 * Video element for emulator stream with touch event capture.
 * Touch coordinates are normalized to 0.0-1.0 and sent via DataChannel.
 */
export function EmulatorStream({ stream, dataChannel }: EmulatorStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
  }, [stream]);

  const sendTouchEvent = (
    action: "down" | "move" | "up",
    event: React.TouchEvent<HTMLVideoElement>,
  ) => {
    if (!dataChannel || dataChannel.readyState !== "open") return;

    const rect = event.currentTarget.getBoundingClientRect();
    const touches = Array.from(event.touches).map((touch) => ({
      x: (touch.clientX - rect.left) / rect.width,
      y: (touch.clientY - rect.top) / rect.height,
      pressure: (touch as unknown as { force?: number }).force || 0.5,
      identifier: touch.identifier,
    }));

    // For "up" events, touches array is empty — use changedTouches
    const activeTouches =
      touches.length > 0
        ? touches
        : Array.from(event.changedTouches).map((touch) => ({
            x: (touch.clientX - rect.left) / rect.width,
            y: (touch.clientY - rect.top) / rect.height,
            pressure: 0,
            identifier: touch.identifier,
          }));

    dataChannel.send(
      JSON.stringify({ type: "touch", action, touches: activeTouches }),
    );
  };

  return (
    <video
      ref={videoRef}
      className="emulator-video"
      autoPlay
      playsInline
      muted
      onTouchStart={(e) => {
        e.preventDefault();
        sendTouchEvent("down", e);
      }}
      onTouchMove={(e) => {
        e.preventDefault();
        sendTouchEvent("move", e);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        sendTouchEvent("up", e);
      }}
    />
  );
}
