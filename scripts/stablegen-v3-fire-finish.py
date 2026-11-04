#!/usr/bin/env python3
"""Publish browser copies and provenance of the new genuine Medium fire takes."""

import argparse
import hashlib
import json
import pathlib
import subprocess
import time

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets" / "v3"
IDS = ["fire-dry-brush", "fire-wind-flames", "fire-ground-embers"]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(samples):
    samples = samples.astype("float64")
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples ** 2)))
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    windows = samples[:len(samples) // 2205 * 2205].reshape(-1, 2205, 2)
    energies = np.sqrt(np.mean(windows ** 2, axis=(1, 2)))
    frames = samples[:len(samples) // 44100 * 44100].reshape(-1, 44100, 2)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(44100)[None, :, None], axis=1)) ** 2
    frequencies = np.fft.rfftfreq(44100, 1 / 44100)
    total = float(spectrum.sum()) or 1
    return {"completeDecode": "passed", "samplesPerChannel": len(samples),
            "nonFiniteSamples": int((~np.isfinite(samples)).sum()), "peakDbfs": db(peak), "rmsDbfs": db(rms),
            "crestDb": db(peak) - db(rms),
            "windowRmsMaxAboveMedianDb": db(energies.max()) - db(np.median(energies)),
            "windowRmsP95AboveMedianDb": db(np.percentile(energies, 95)) - db(np.median(energies)),
            "spectralEnergyAbove6kHz": float(spectrum[:, frequencies >= 6000, :].sum() / total),
            "scope": "Signal measurements only; perceptual dryness and prompt adherence require audition."}


def finish(identifier):
    record_path = ASSETS / (identifier + "-generation.json")
    row = json.loads(record_path.read_text())
    if row["status"] != "generated":
        raise RuntimeError("Generation is not complete: " + identifier)
    master = ASSETS / row["master"]["file"]
    if sha256(master) != row["master"]["sha256"]:
        raise RuntimeError("Generated master hash does not match: " + identifier)
    samples, rate = sf.read(master, dtype="float32", always_2d=True)
    if not np.all(np.isfinite(samples)) or float(np.sqrt(np.mean(samples.astype("float64") ** 2))) < 1e-7:
        raise RuntimeError("Refusing to amplify invalid or silent generated audio: " + identifier)
    gain = 10 ** (-4 / 20) / max(float(np.abs(samples).max()), 1e-8)
    output = ASSETS / (identifier + ".mp3")
    duration = row["durationSeconds"]
    subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master),
        "-af", f"volume={gain:.12f},afade=t=in:st=0:d=0.15,afade=t=out:st={duration-.4}:d=0.4",
        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", str(output),
    ], check=True)
    raw = subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-i", str(output), "-f", "f32le", "-ac", "2", "-ar", "44100", "-"])
    decoded = np.frombuffer(raw, dtype="<f4").reshape(-1, 2)
    validation = metrics(decoded)
    if validation["nonFiniteSamples"]:
        raise RuntimeError("Decoded MP3 contains invalid samples")
    if validation["peakDbfs"] > -3:
        raise RuntimeError("Decoded MP3 exceeds the conservative -3dBFS peak limit")
    row.update({"id": identifier, "kind": "forest", "title": row["title"], "description": row["role"],
                "file": str(output.relative_to(ROOT)), "bytes": output.stat().st_size, "sha256": sha256(output),
                "validation": validation, "masterValidation": metrics(samples),
                "processing": "Unchanged generated master retained. Browser MP3: peak-normalize master to -4dBFS before encoding,150ms fade-in and400ms fade-out, stereo44.1kHz160kbps. No reverb, echo, compression, filtering, layering, rhythmic edits, or external recording added.",
                "normalizationGain": gain})
    (ASSETS / (identifier + "-source.json")).write_text(json.dumps(row, indent=2) + "\n")
    print(json.dumps({key: row[key] for key in ["id", "file", "model", "bytes", "sha256", "validation"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait", action="store_true")
    parser.add_argument("--only", choices=IDS, nargs="+", default=IDS)
    args = parser.parse_args()
    for identifier in args.only:
        path = ASSETS / (identifier + "-generation.json")
        deadline = time.time() + 2400
        while not path.exists():
            if not args.wait:
                raise FileNotFoundError(path)
            if time.time() >= deadline:
                raise TimeoutError("No generated fire master arrived: " + identifier)
            time.sleep(1)
        finish(identifier)


if __name__ == "__main__":
    main()
