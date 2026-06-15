export const SPEECH_CAPTURE_SAMPLE_RATE = 16_000;

let sharedWarmStream: MediaStream | null = null;
let sharedWarmDeviceKey: string | null = null;
let sharedWarmRequest: Promise<MediaStream> | null = null;
let sharedWarmRequestKey: string | null = null;
let sharedWarmGeneration = 0;

function deviceKey(micDeviceId: string | null | undefined): string {
  return micDeviceId ?? "";
}

export function hasLiveSpeechTracks(
  stream: MediaStream | null,
): stream is MediaStream {
  return (
    stream?.getTracks().some((track) => track.readyState !== "ended") === true
  );
}

export function stopSpeechStreamTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

export function isSharedSpeechMicStream(stream: MediaStream | null): boolean {
  return stream !== null && stream === sharedWarmStream;
}

export function speechMicConstraints(
  micDeviceId: string | null | undefined,
): MediaStreamConstraints {
  return {
    audio: {
      ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
      // A single YA-controlled capture shape avoids paying a fresh
      // getUserMedia/device path when the user switches STT backends.
      channelCount: { ideal: 1 },
      sampleRate: { ideal: SPEECH_CAPTURE_SAMPLE_RATE },
      sampleSize: { ideal: 16 },
      // Capture raw mic audio. The selected OS/browser device is the gain and
      // processing choice; YA should not silently route some backends through
      // browser call-processing while others use raw PCM.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  };
}

export function releaseSharedSpeechMicStream(): void {
  sharedWarmGeneration += 1;
  if (sharedWarmStream) {
    stopSpeechStreamTracks(sharedWarmStream);
  }
  sharedWarmStream = null;
  sharedWarmDeviceKey = null;
  sharedWarmRequest = null;
  sharedWarmRequestKey = null;
}

export function getSpeechMicStream({
  keepWarm,
  micDeviceId,
}: {
  keepWarm: boolean;
  micDeviceId?: string | null;
}): Promise<MediaStream> {
  const key = deviceKey(micDeviceId);
  const constraints = speechMicConstraints(micDeviceId);
  if (!keepWarm) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  if (sharedWarmDeviceKey !== null && sharedWarmDeviceKey !== key) {
    releaseSharedSpeechMicStream();
  }
  sharedWarmDeviceKey = key;

  if (hasLiveSpeechTracks(sharedWarmStream)) {
    return Promise.resolve(sharedWarmStream);
  }
  if (sharedWarmRequest && sharedWarmRequestKey === key) {
    return sharedWarmRequest;
  }

  const generation = sharedWarmGeneration;
  const request = navigator.mediaDevices.getUserMedia(constraints);
  sharedWarmRequest = request;
  sharedWarmRequestKey = key;

  return request
    .then((stream) => {
      if (
        generation === sharedWarmGeneration &&
        sharedWarmRequest === request &&
        sharedWarmDeviceKey === key
      ) {
        sharedWarmStream = stream;
      } else if (hasLiveSpeechTracks(stream)) {
        stopSpeechStreamTracks(stream);
      }
      return stream;
    })
    .finally(() => {
      if (sharedWarmRequest === request) {
        sharedWarmRequest = null;
        sharedWarmRequestKey = null;
      }
    });
}
