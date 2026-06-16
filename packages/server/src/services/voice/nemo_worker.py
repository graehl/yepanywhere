#!/usr/bin/env python3
"""
Warm NeMo Parakeet subprocess worker for YA local speech recognition.

Loads the model once, then reads JSON requests from stdin and writes JSON
responses to stdout. The Node.js LocalNemoBackend keeps this process alive
between utterances to avoid per-utterance model load.

Request line:  {"audio_b64":"<base64>","mime_type":"audio/webm;codecs=opus"}
Response line: {"text":"..."} or {"error":"..."}
Startup line:  {"status":"ready"} (written once after model loads)
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
from typing import Any


DEFAULT_NEMO_MODEL = "nvidia/parakeet-tdt-0.6b-v3"


def suffix_for_mime(mime: str) -> str:
    if "ogg" in mime:
        return ".ogg"
    if "mp4" in mime or "m4a" in mime:
        return ".mp4"
    if "wav" in mime:
        return ".wav"
    if "mp3" in mime:
        return ".mp3"
    if "flac" in mime:
        return ".flac"
    return ".webm"


def unlink_if_present(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def patch_numpy_sctypes() -> None:
    import numpy as np  # type: ignore[import]

    if hasattr(np, "sctypes"):
        return
    # NeMo 2.0.0 still references np.sctypes during audio preprocessing.
    np.sctypes = {
        "int": [np.int8, np.int16, np.int32, np.int64],
        "uint": [np.uint8, np.uint16, np.uint32, np.uint64],
        "float": [np.float16, np.float32, np.float64],
        "complex": [np.complex64, np.complex128],
        "others": [np.bool_, np.object_, np.bytes_, np.str_],
    }


def resolve_device(device_arg: str, torch: Any) -> str:
    normalized = device_arg.strip().lower()
    if normalized in ("", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if normalized == "cuda":
        return "cuda"
    if normalized.startswith("cuda:"):
        return normalized
    if normalized == "cpu":
        return "cpu"
    return normalized


def transcript_text(output: Any) -> str:
    if isinstance(output, str):
        return output.strip()
    if isinstance(output, dict):
        return str(output.get("text") or "").strip()
    if isinstance(output, (list, tuple)):
        parts = [transcript_text(item) for item in output]
        parts = [part for part in parts if part]
        if not parts:
            return ""
        if all(part == parts[0] for part in parts):
            return parts[0]
        return " ".join(parts).strip()
    return str(output or "").strip()


def wav_path_for_nemo(input_path: str, suffix: str) -> str:
    if suffix == ".wav":
        return input_path

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        output_path = fh.name

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-i",
                input_path,
                "-ac",
                "1",
                "-ar",
                "16000",
                output_path,
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        unlink_if_present(output_path)
        stderr = exc.stderr.decode("utf-8", errors="replace").strip()
        if len(stderr) > 500:
            stderr = stderr[:500].rstrip() + "..."
        raise RuntimeError(f"ffmpeg audio conversion failed: {stderr}") from exc

    return output_path


def summarize_model_load_error(model_name: str, exc: Exception) -> str:
    message = str(exc)
    lower = message.lower()
    if "no space left on device" in lower or "os error 28" in lower:
        return (
            f"Model load failed for {model_name}: no space left on device while "
            "downloading or reconstructing Hugging Face model files. Free the "
            "cache/tmp filesystem used by the server, or set HF_HUB_CACHE, "
            "HF_XET_CACHE, and TMPDIR to a filesystem with enough space before "
            "starting YA."
        )
    if "att_chunk_context_size" in message:
        return (
            f"Model load failed for {model_name}: this model needs a newer "
            "NeMo encoder than the YA pixi stt NeMo 2.0.0 add-on provides. "
            "Use nvidia/parakeet-tdt-0.6b-v3, nvidia/parakeet-rnnt-1.1b, "
            "or nvidia/parakeet-ctc-1.1b here; keep unified Parakeet models "
            "on the separate modern-NeMo track."
        )
    if (
        "gated repo" in lower
        or "gated model" in lower
        or "401" in lower
        or "403" in lower
        or "access to model" in lower
    ):
        return (
            f"Model load failed for {model_name}: Hugging Face authentication "
            "or model access is required. Run `pixi run --frozen -e stt hf auth "
            "login`, accept the model terms on Hugging Face if prompted, then "
            "restart YA."
        )
    compact = " ".join(message.split())
    if len(compact) > 700:
        compact = compact[:700].rstrip() + "..."
    return f"Model load failed for {model_name}: {compact}"


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NEMO_MODEL
    device_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"

    sys.stderr.write(f"[nemo_worker] Loading {model_name} on device={device_arg}...\n")
    sys.stderr.flush()

    try:
        patch_numpy_sctypes()
        import torch  # type: ignore[import]
        from nemo.collections.asr.models import ASRModel  # type: ignore[import]

        device = resolve_device(device_arg, torch)
        model = ASRModel.from_pretrained(model_name, map_location=device)
        if device.startswith("cuda"):
            model = model.to(device)
        model.eval()
    except Exception as exc:
        sys.stdout.write(
            json.dumps({"error": summarize_model_load_error(model_name, exc)}) + "\n"
        )
        sys.stdout.flush()
        sys.exit(1)

    sys.stderr.write("[nemo_worker] Model ready\n")
    sys.stderr.flush()
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"error": f"JSON error: {exc}"}) + "\n")
            sys.stdout.flush()
            continue

        try:
            audio_bytes = base64.b64decode(req["audio_b64"])
            suffix = suffix_for_mime(str(req.get("mime_type") or ""))

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
                fh.write(audio_bytes)
                tmpfile = fh.name

            transcription_file = tmpfile
            try:
                transcription_file = wav_path_for_nemo(tmpfile, suffix)
                output = model.transcribe(
                    [transcription_file], batch_size=1, verbose=False
                )
                sys.stdout.write(json.dumps({"text": transcript_text(output)}) + "\n")
            finally:
                unlink_if_present(tmpfile)
                if transcription_file != tmpfile:
                    unlink_if_present(transcription_file)

        except Exception as exc:
            sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")

        sys.stdout.flush()


if __name__ == "__main__":
    main()
