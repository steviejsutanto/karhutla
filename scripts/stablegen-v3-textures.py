#!/usr/bin/env python3
"""Generate or finish a documented official Stable Audio 3 texture batch.

The default action prints a plan without inference or shared GPU quota use.
--adopt-generated finishes proven WAV outputs from the shared local batch.
Use --generate only after coordinating quota or local GPU access. Every
complete result is saved immediately; successful assets remain unchanged.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import pathlib
import subprocess
import sys
import time

import numpy as np
import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets" / "v3"
PROMPTS = pathlib.Path(__file__).with_name("stablegen-v3-textures-prompts.json")
RECORDS = ASSETS / "textures-generation.json"
SPACE = "https://stabilityai-stable-audio-3.hf.space"


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, document):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n")
    temporary.replace(path)


def read_active_json(path):
    # The shared generation process may be updating its batch record while
    # this CPU-only finisher works on the preceding completed WAV.
    for attempt in range(5):
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            if attempt == 4:
                raise
            time.sleep(.05)


def save(document):
    write_json(RECORDS, document)


def audio_metrics(path):
    decoded = subprocess.check_output([
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
        "-f", "f32le", "-ac", "2", "-ar", "44100", "-",
    ])
    samples = np.frombuffer(decoded, dtype="<f4").reshape(-1, 2).astype(np.float64)
    finite = np.isfinite(samples)
    clean = np.nan_to_num(samples)
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    rms = np.sqrt(np.mean(clean * clean))
    peak = np.max(np.abs(clean))
    win = 2205  # 50ms windows make unusual isolated bursts inspectable.
    windows = clean[:len(clean) // win * win].reshape(-1, win, 2)
    energies = np.sqrt(np.mean(windows * windows, axis=(1, 2)))
    median = np.median(energies)
    # Whole-second Hann windows; average both channels' spectral energies.
    frames = clean[:len(clean) // 44100 * 44100].reshape(-1, 44100, 2)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(44100)[None, :, None], axis=1)) ** 2
    frequency = np.fft.rfftfreq(44100, 1 / 44100)
    total = float(spectrum.sum()) or 1
    bands = {}
    for lo, hi in [(0, 120), (120, 500), (500, 2000), (2000, 6000), (6000, 22050)]:
        bands[f"{lo}-{hi}Hz"] = float(spectrum[:, (frequency >= lo) & (frequency < hi), :].sum() / total)
    return {
        "completeDecode": "passed", "samplesPerChannel": len(samples),
        "nonFiniteSamples": int((~finite).sum()), "peakAmplitude": float(peak), "peakDbfs": db(peak), "rmsDbfs": db(rms),
        "crestDb": db(peak) - db(rms),
        "nearFullScaleSampleFraction": float(np.mean(np.abs(clean) >= .999)),
        "quietWindowFractionBelowMinus65Dbfs": float(np.mean(energies < 10 ** (-65 / 20))),
        "windowRmsP95AboveMedianDb": db(np.percentile(energies, 95)) - db(median),
        "windowRmsMaxAboveMedianDb": db(np.max(energies)) - db(median),
        "spectralEnergyFractions": bands,
        "scope": "Signal measurements only; not a perceptual certification of source, dryness, or absence of musical content.",
    }


def finish_asset(wav, preset, duration, record):
    mp3 = ASSETS / (preset["id"] + ".mp3")
    master_metrics = audio_metrics(wav)
    if master_metrics["nonFiniteSamples"] or master_metrics["peakAmplitude"] <= 1e-8:
        raise RuntimeError(f"Generated master is non-finite or has no usable signal: {wav}")
    normalization_db = -4 - master_metrics["peakDbfs"]
    # The generated master stays unchanged. The browser copy receives only
    # boundary fades and conservative headroom; no fake sources are layered in.
    fade_start = max(0, duration - .5)
    codec_correction_db = 0
    bitrate_kbps = preset.get('bitrateKbps', 160)
    for attempt in range(3):
        filters = f"afade=t=in:st=0:d=0.25,afade=t=out:st={fade_start}:d=0.5,volume={normalization_db:.9f}dB"
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(wav), "-t", str(duration), "-af", filters,
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", f"{bitrate_kbps}k", str(mp3),
        ], check=True)
        browser_metrics = audio_metrics(mp3)
        if browser_metrics["peakDbfs"] <= -3:
            break
        correction = browser_metrics["peakDbfs"] + 3.25
        normalization_db -= correction
        codec_correction_db += correction
    else:
        raise RuntimeError(f"Encoded MP3 exceeds -3dBFS peak ceiling: {mp3}")
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,sample_rate,channels", "-of", "json", str(mp3),
    ]))
    record.update({
        "status": "generated", "completedAt": now(),
        "wavMaster": {"file": wav.name, "bytes": wav.stat().st_size, "sha256": sha256(wav)},
        "browserAsset": {"file": mp3.name, "bytes": mp3.stat().st_size, "sha256": sha256(mp3), "bitrateKbps": bitrate_kbps, "probe": probe},
        "validation": {**browser_metrics, "encodedPeakCeilingDbfs": -3, "encodedPeakCheck": "passed"},
        "masterValidation": master_metrics,
        "processing": f"Original generated float WAV retained unchanged; MP3: 250ms fade-in, 500ms fade-out, raw master peak normalized near -4dBFS before encoding, stereo44.1kHz{bitrate_kbps}kbps. Any codec overshoot is corrected by encoding again directly from the unchanged original master. Complete MP3 decode and encoded peak <= -3dBFS checks passed.",
        "normalization": {"targetPeakDbfsBeforeEncoding": -4, "appliedGainDb": normalization_db, "codecHeadroomCorrectionDb": codec_correction_db},
        "listeningReview": "Not certified by a human listener. Technical validation does not establish prompt adherence.",
    })
    write_json(ASSETS / (preset["id"] + "-source.json"), record)
    print(f"Saved {mp3.name}: {mp3.stat().st_size} bytes", flush=True)


def fetch_result(session, file_data, preset, duration, record):
    wav = ASSETS / (preset["id"] + "-master.wav")
    url = file_data.get("url") or f"{SPACE}/gradio_api/file={file_data['path']}"
    response = session.get(url, timeout=(15, 180))
    response.raise_for_status()
    wav.write_bytes(response.content)
    record["sourceFileData"] = file_data
    finish_asset(wav, preset, duration, record)


def generate_mlx(preset, settings, args, record):
    runtime = pathlib.Path(args.runtime)
    if not runtime.is_file():
        raise FileNotFoundError(f"Official MLX runtime missing: {runtime}")
    wav = ASSETS / (preset["id"] + "-master.wav")
    log = ASSETS / (preset["id"] + "-generation.log")
    model = "medium" if args.model == "medium" else "sm-sfx"
    decoder = "same-l" if args.model == "medium" else "same-s"
    command = [
        args.python, str(runtime), "--dit", model, "--decoder", decoder,
        "--seconds", str(args.duration), "--steps", str(settings["steps"]),
        "--cfg", str(settings["cfgScale"]), "--seed", str(preset["seed"]),
        "--prompt", preset["prompt"], "--out", str(wav),
    ]
    record["request"] = {"backend": "official MLX local inference", "command": command}
    record["localRuntime"] = {
        "script": str(runtime), "scriptSha256": sha256(runtime),
        "repository": "https://github.com/Stability-AI/stable-audio-3",
        "weightsRepository": "https://huggingface.co/stabilityai/stable-audio-3-optimized",
        "runtimeRevision": args.runtime_revision,
    }
    print(f"Generating {preset['id']} locally with {model}", flush=True)
    with log.open("w") as output:
        subprocess.run(command, cwd=runtime.parent.parent, stdout=output, stderr=subprocess.STDOUT, check=True)
    record["generationLog"] = log.name
    finish_asset(wav, preset, args.duration, record)


def generate(session, preset, settings, model, duration, record):
    data = [model, preset["prompt"], duration, settings["steps"], settings["cfgScale"], settings["sampler"], preset["seed"]]
    record["request"] = {"apiName": "/infer", "data": data}
    response = session.post(f"{SPACE}/gradio_api/call/infer", json={"data": data}, timeout=(15, 60))
    response.raise_for_status()
    event_id = response.json()["event_id"]
    record["eventId"] = event_id
    print(f"Queued {preset['id']} with {model} ({event_id})", flush=True)
    with session.get(f"{SPACE}/gradio_api/call/infer/{event_id}", stream=True, timeout=(15, 300)) as events:
        events.raise_for_status()
        event = None
        for line in events.iter_lines(decode_unicode=True):
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                value = json.loads(line[6:])
                if event == "error":
                    raise RuntimeError(f"Official Space generation error: {value}")
                if event == "complete":
                    fetch_result(session, value[0], preset, duration, record)
                    return
    raise RuntimeError("Official Space returned no completed audio result")


def main():
    settings = json.loads(PROMPTS.read_text())
    presets = {preset["id"]: preset for preset in settings["assets"]}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=pathlib.Path, default=PROMPTS)
    parser.add_argument("--batch-record", type=pathlib.Path, default=ASSETS / "medium-batch.json")
    parser.add_argument("--only", nargs="+", choices=presets)
    parser.add_argument("--model", choices=["medium", "small-sfx"])
    parser.add_argument("--backend", choices=["space", "mlx"], default="space")
    parser.add_argument("--runtime", default="/private/tmp/wildfire-stable-audio-3/optimized/mlx/scripts/sa3_mlx.py")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--runtime-revision", default=None)
    parser.add_argument("--duration", type=int)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--generate", action="store_true")
    action.add_argument("--adopt-generated", action="store_true", help="Finish already generated local WAVs using each exact *-generation.json record; never runs inference")
    args = parser.parse_args()
    if args.pack != PROMPTS:
        settings = json.loads(args.pack.read_text())
        presets = {preset["id"]: preset for preset in settings["assets"]}
    args.only = args.only or list(presets)
    args.model = args.model or settings["preferredModel"]
    args.duration = args.duration or settings["durationSeconds"]
    if not args.generate and not args.adopt_generated:
        print(json.dumps({"status": "planOnly", "backend": args.backend, "model": args.model, "duration": args.duration, "assets": [presets[key] for key in args.only]}, indent=2))
        return
    if not 1 <= args.duration <= (380 if args.model == "medium" else 120):
        parser.error("Duration exceeds model limit")
    ASSETS.mkdir(parents=True, exist_ok=True)
    document = json.loads(RECORDS.read_text()) if RECORDS.exists() else {
        "provider": "Stability AI official public Hugging Face Space or official local MLX runtime; per-asset request records exact route",
        "sourceUrl": settings["space"], "modelLicense": "Stable Audio Community License",
        "notes": "Genuine text-to-audio only. No field recordings or synthesized replacements are presented as model outputs. Failed requests are retained as failures.", "assets": {},
    }
    session = requests.Session()
    for key in args.only:
        previous = document["assets"].get(key, {})
        if previous.get("status") == "generated":
            keep = not args.adopt_generated
            if args.adopt_generated:
                proof = read_active_json(ASSETS / (key + "-generation.json"))
                keep = (previous.get("wavMaster", {}).get("sha256") == proof.get("master", {}).get("sha256")
                        and (ASSETS / previous.get("browserAsset", {}).get("file", "missing")).is_file()
                        and (ASSETS / (key + "-source.json")).is_file())
            if keep:
                print(f"Keeping completed texture: {key}", flush=True)
                continue
        preset = presets[key]
        if args.adopt_generated:
            proof_path = ASSETS / (key + "-generation.json")
            proof = read_active_json(proof_path)
            if proof.get("generated") is not True or proof.get("status") != "generated" or proof.get("id") != key:
                raise RuntimeError(f"Missing genuine completed generation record: {proof_path}")
            if proof["prompt"] != preset["prompt"] or proof["seed"] != preset["seed"]:
                raise RuntimeError(f"Generated request differs from current documented prompt pack: {key}")
            wav = ASSETS / proof["master"]["file"]
            if sha256(wav) != proof["master"]["sha256"]:
                raise RuntimeError(f"Generated WAV hash differs from its completed record: {wav}")
            record = {**proof, "modelCard": proof["modelUrl"], "adoptedAt": now()}
            batch = read_active_json(args.batch_record)
            record["batchRecord"] = args.batch_record.name
            record["verifiedWeights"] = batch["verifiedWeights"]
            record["device"] = batch["device"]
            document["assets"][key] = record
            finish_asset(wav, preset, proof["durationSeconds"], record)
            save(document)
            continue
        record = {**preset, "model": args.model, "modelCard": f"https://huggingface.co/stabilityai/stable-audio-3-{args.model}",
                  "durationSeconds": args.duration, "startedAt": now(), "status": "queued"}
        document["assets"][key] = record
        save(document)
        try:
            if args.backend == "mlx":
                generate_mlx(preset, settings, args, record)
            else:
                generate(session, preset, settings, args.model, args.duration, record)
        except Exception as error:
            record.update({"status": "failed", "error": f"{type(error).__name__}: {error}"})
            save(document)
            raise
        save(document)


if __name__ == "__main__":
    main()
