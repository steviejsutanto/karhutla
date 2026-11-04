#!/usr/bin/env python3
"""Blend the three documented SA3 fire masters into the main browser asset.

No generation or network request happens here. Preserve each genuine master,
overlay independent takes without a beat or clock, and peak-normalize the mix.
"""

import hashlib
import json
import pathlib
import subprocess
import tempfile
from datetime import datetime, timezone

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets"
WEIGHTS = {"close": .55, "middle": .28, "distant": .17}
LICENSE_URL = "https://huggingface.co/stabilityai/stable-audio-3-small-sfx/blob/main/LICENSE.md"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest_path = ASSETS / "stable-audio-generation.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["license_reference"] = LICENSE_URL
    sources = []
    for key, weight in WEIGHTS.items():
        record = manifest["assets"][key]
        master = ASSETS / record["wav_master"]["file"]
        if sha256(master) != record["wav_master"]["sha256"]:
            raise RuntimeError(f"Master hash changed: {master.name}")
        record.update({"sourceUrl": manifest["space"], "model": manifest["model"],
                       "modelLicense": "Stable Audio Community License", "modelLicenseUrl": LICENSE_URL})
        sources.append({"perspective": key, "amplitudeWeight": weight, "master": record["wav_master"],
                        "sourceUrl": manifest["space"], "model": manifest["model"],
                        "modelLicense": "Stable Audio Community License", "modelLicenseUrl": LICENSE_URL,
                        "prompt": record["prompt"], "seed": record["seed"], "eventId": record["event_id"],
                        "steps": record["steps"], "cfgScale": record["cfg_scale"], "sampler": record["sampler"]})
    with tempfile.TemporaryDirectory(prefix="wildfire-stable-mix-") as folder:
        folder = pathlib.Path(folder)
        float_mix = folder / "mix-f32.wav"
        command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
        for source in sources:
            command.extend(["-i", str(ASSETS / source["master"]["file"])])
        command.extend(["-filter_complex", "amix=inputs=3:weights='0.55 0.28 0.17':normalize=0",
                        "-c:a", "pcm_f32le", str(float_mix)])
        subprocess.run(command, check=True)
        samples, rate = sf.read(float_mix, dtype="float32", always_2d=True)
        original_peak = float(np.max(np.abs(samples)))
        gain = (10 ** (-3.8 / 20)) / max(original_peak, 1e-8)
        output = ASSETS / "burning-forest.pending.mp3"
        for attempt in range(3):
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(float_mix),
                "-af", f"volume={gain:.12f},afade=t=in:st=0:d=0.12,afade=t=out:st=59.65:d=0.35",
                "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", str(output),
            ], check=True)
            decoded = subprocess.check_output([
                "ffmpeg", "-nostdin", "-v", "error", "-i", str(output), "-f", "f32le", "-c:a", "pcm_f32le", "-",
            ])
            decoded = np.frombuffer(decoded, dtype="<f4")
            peak = float(np.max(np.abs(decoded)))
            rms = float(np.sqrt(np.mean(decoded.astype("float64") ** 2)))
            peak_db = float(20 * np.log10(max(peak, 1e-12)))
            if peak_db <= -3:
                break
            gain *= 10 ** ((-3.3 - peak_db) / 20)
        else:
            raise RuntimeError("Encoded peak did not meet the -3 dBFS ceiling")
        if not np.all(np.isfinite(decoded)):
            raise RuntimeError("Decoded MP3 contains invalid sample values")
        destination = ASSETS / "burning-forest.mp3"
        output.replace(destination)
        metadata = {
            "file": destination.name,
            "description": "Full-strength forest wildfire bed, weighted overlay of three independent genuine Stable Audio 3.0 Small SFX generations.",
            "sourceUrl": manifest["space"], "model": manifest["model"],
            "modelUrl": manifest["model_card"], "modelLicense": "Stable Audio Community License",
            "modelLicenseUrl": LICENSE_URL, "spaceRevision": manifest["space_revision"],
            "createdAt": datetime.now(timezone.utc).isoformat(), "sources": sources,
            "durationSeconds": 60, "sampleRate": rate, "channels": 2, "bitrate": 160000,
            "bytes": destination.stat().st_size, "sha256": sha256(destination),
            "processing": "Overlay close/middle/distant masters at linear amplitude weights 0.55/0.28/0.17. Peak-normalize the full mix to -3.8 dBFS before MP3 encoding, with 120 ms fade-in and 350 ms fade-out. Validate encoded peak <= -3 dBFS. No compression, temporal quantization, pitch shift, added rhythm, music, or external field recording.",
            "normalizationGain": gain,
            "validation": {"completeDecode": "passed", "peakDbfs": peak_db,
                           "rmsDbfs": float(20 * np.log10(max(rms, 1e-12))),
                           "NaN": 0, "Inf": 0, "decodedSamplesPerChannel": len(decoded) // 2},
            "listeningReview": "Not certified by a human listener; prompt adherence must be assessed by listening.",
            "reproduce": "python3 scripts/generate-stable-wildfire-mix.py",
        }
        (ASSETS / "burning-forest-source.json").write_text(json.dumps(metadata, indent=2) + "\n")
        manifest["mainAsset"] = {key: metadata[key] for key in ["file", "bytes", "sha256", "sourceUrl", "model", "modelLicense", "modelLicenseUrl", "validation"]}
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({key: metadata[key] for key in ["file", "bytes", "sha256", "validation"]}, indent=2))


if __name__ == "__main__":
    main()
