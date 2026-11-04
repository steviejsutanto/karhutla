#!/usr/bin/env python3
"""Shape genuine Medium ash audio into one dry, continuous reviewable layer.

No model inference or external recording is used. The raw generated float WAV
remains untouched; every browser copy and processing step is documented.
"""

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import pathlib
import subprocess

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets" / "v3"


def main():
    spec = importlib.util.spec_from_file_location("wildfire_texture_finisher", pathlib.Path(__file__).with_name("stablegen-v3-textures.py"))
    finish = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(finish)
    proof = json.loads((ASSETS / "ash-generation.json").read_text())
    raw = ASSETS / proof["master"]["file"]
    if proof.get("generated") is not True or finish.sha256(raw) != proof["master"]["sha256"]:
        raise RuntimeError("Ash source is not the exact completed genuine model output")
    decoded = subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(raw), "-f", "f32le", "-ac", "2", "-ar", "44100", "-"])
    samples = np.frombuffer(decoded, dtype="<f4").reshape(-1, 2)
    if not np.all(np.isfinite(samples)):
        raise RuntimeError("Source contains non-finite audio")
    # Equal-power overlap at the source loop seam, then four simultaneous
    # phase-offset views of that same source. This fills its long gaps using
    # genuine ash detail rather than replacing them with synthesized noise.
    fade_frames = round(.45 * 44100)
    phase = np.linspace(0, np.pi / 2, fade_frames, dtype=np.float32)[:, None]
    blend = samples[-fade_frames:] * np.cos(phase) + samples[:fade_frames] * np.sin(phase)
    loop = np.concatenate([samples[fade_frames:-fade_frames], blend], axis=0)
    offsets = [0, len(loop) // 4, len(loop) // 2, 3 * len(loop) // 4]
    positions = np.arange(len(samples))
    layered = np.zeros_like(samples)
    for offset in offsets:
        layered += .25 * loop[(positions + offset) % len(loop)]
    derived = ASSETS / "ash-processed-master.wav"
    filters = "highpass=f=100,lowpass=f=2800:p=2,lowpass=f=2800:p=2,acompressor=threshold=0.008:ratio=4:attack=8:release=180:makeup=1:knee=2.828:detection=rms:link=average"
    subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "f32le", "-ar", "44100", "-ac", "2", "-i", "pipe:0",
        "-af", filters, "-c:a", "pcm_f32le", str(derived),
    ], input=layered.astype("<f4").tobytes(), check=True)
    original = json.loads((ASSETS / "rejected" / "ash-retry-raw-source.json").read_text())
    record = {
        "id": "ash", "title": "Soft ash flutter · shaped Medium texture",
        "role": "Continuous soft midrange ash detail",
        "assetKind": "processed-derivative-of-genuine-model-output", "rawModelOutput": False,
        "derivedFromGenuineModelOutput": True,
        **{key: proof[key] for key in ["model", "modelUrl", "sourceUrl", "license", "licenseUrl", "backend", "runtimeRevision", "optimizedWeightsRevision", "seed", "prompt", "durationSeconds"]},
        "modelCard": proof["modelUrl"], "sourceGeneration": proof,
        "verifiedWeights": original["verifiedWeights"], "device": original["device"],
        "rawGeneratedMaster": {"file": raw.name, "bytes": raw.stat().st_size, "sha256": finish.sha256(raw)},
        "rawBrowserStudy": {"file": "rejected/ash-retry-raw.mp3", "sha256": finish.sha256(ASSETS / "rejected" / "ash-retry-raw.mp3")},
        "processingStartedAt": datetime.now(timezone.utc).isoformat(),
        "derivation": {
            "source": "Only the unchanged genuine Medium ash retry; no other recording or generated noise was added",
            "loopSeamCrossfadeSeconds": .45,
            "phaseOffsetsSeconds": [offset / 44100 for offset in offsets], "streamGainEach": .25,
            "filters": filters,
            "description": "Four phase-offset layers of the same ash source fill gaps; 100Hz high-pass and two 2800Hz low-pass stages soften the bright edge; gentle RMS compression reduces isolated transients. Dry processing only: no reverb, delay, music, external sounds, or additional model generation.",
        },
    }
    finish.finish_asset(derived, {"id": "ash"}, proof["durationSeconds"], record)
    record["processing"] = record["derivation"]["description"] + " Final browser copy: 250ms/500ms boundary fades and measured peak normalization near -4dBFS, stereo44.1kHz160kbps MP3; encoded peak <= -3dBFS verified. Raw generated float master is preserved unchanged."
    record["sourceMasterUnchangedCheck"] = finish.sha256(raw) == proof["master"]["sha256"]
    finish.write_json(ASSETS / "ash-source.json", record)
    document = json.loads(finish.RECORDS.read_text())
    document["assets"]["ash"] = record
    finish.save(document)
    print(json.dumps({"assetKind": record["assetKind"], "validation": record["validation"], "rawMasterUnchanged": record["sourceMasterUnchangedCheck"]}, indent=2))


if __name__ == "__main__":
    main()
