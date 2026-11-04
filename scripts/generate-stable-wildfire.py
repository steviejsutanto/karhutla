#!/usr/bin/env python3
"""Generate documented wildfire assets with Stability AI's public SA3 Space.

Requires requests and ffmpeg. No API key is needed for the public demo, which
may impose a queue or quota. No paid service is used. Each success is recorded
immediately, so a later quota failure cannot erase the earlier provenance.
"""

import argparse
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets"
MANIFEST = ASSETS / "stable-audio-generation.json"
SPACE = "https://stabilityai-stable-audio-3.hf.space"
SPACE_REPO = "stabilityai/stable-audio-3"
MODEL = "small-sfx"
PRESETS = {
    "close": {
        "name": "stable-fire-close",
        "seed": 2026103101,
        "prompt": "A catastrophic intense forest wildfire at full strength, close perspective. Dense irregular loud fire crackling, roaring turbulent flames, dry twigs snapping unpredictably, huge burning tree trunks creaking and cracking, powerful ember gusts and harsh rushing air. Continuous chaotic natural environmental sound, unmetered, wild, dangerous, detailed stereo field recording. No animals, no crickets, no birds, no insects, no music, no rhythm, no percussion, no speech, no voices, no sirens.",
    },
    "middle": {
        "name": "stable-fire-middle",
        "seed": 2026103102,
        "prompt": "An immense raging forest wildfire engulfing a dense forest, heard from the middle distance. Continuous deep turbulent roaring flame fronts surge and recede chaotically. Countless dry branches snap at unpredictable scattered times. Heavy burning trunks creak and fracture, brief sharp wood cracks burst through the broad rushing inferno. Hot wind and ember gusts sweep through a wide stereo field. Intense dangerous natural disaster field recording, sustained full-strength fire, organic irregular dynamics, unmetered environmental noise. No music, no beat, no rhythm, no drums, no voice, no speech, no birds, no crickets, no insects, no animals, no sirens.",
    },
    "distant": {
        "name": "stable-fire-distant",
        "seed": 2026103103,
        "prompt": "A vast catastrophic forest fire roaring across a hillside, heard at a distance across the forest. Powerful low rushing flames and turbulent hot wind create a continuous broad spatial roar, with irregular violent surges, remote heavy tree cracks, random far-away branch snaps and dense rolling ember gusts. Dangerous raging wildfire at its maximum strength, organic chaotic unmetered natural environmental sound, wide stereo outdoor field recording. No music, no rhythm, no beat, no instruments, no voices, no speech, no birds, no crickets, no insects, no animals, no rain, no sirens.",
    },
    "insects": {
        "name": "stable-insects-night",
        "seed": 2026103104,
        "prompt": "Quiet tropical forest at night after the rain has stopped. A gentle natural chorus of small crickets and soft night insects, individual chirps at different irregular times and distances, delicate leaves moving in a very light breeze, open still air and spacious peaceful outdoor ambience. Subtle restrained stereo field recording, no dramatic sound. No fire, no crackling, no roaring, no music, no rhythm track, no beat, no instruments, no voices, no speech, no birds, no frogs, no traffic, no rain.",
    },
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_manifest(document):
    MANIFEST.write_text(json.dumps(document, indent=2) + "\n")


def finish_record(session, preset, record, file_data):
    stem = preset["name"]
    wav = ASSETS / f"{stem}-space.wav"
    mp3 = ASSETS / f"{stem}.mp3"
    url = file_data.get("url") or f"{SPACE}/gradio_api/file={file_data['path']}"
    response = session.get(url, timeout=(15, 120))
    response.raise_for_status()
    wav.write_bytes(response.content)
    # Preserve the WAV unchanged. Only the browser copy receives quiet boundary
    # fades and 3 dB of headroom; no compression, rhythmic edits, or layering.
    subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
        "-af", "afade=t=in:st=0:d=0.12,afade=t=out:st=59.65:d=0.35,volume=-3dB",
        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "3", str(mp3),
    ], check=True)
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,sample_rate,channels",
        "-of", "json", str(mp3),
    ]))
    # Decode the complete delivered asset, rather than trusting its extension.
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(mp3), "-f", "null", "-"], check=True)
    record.update({
        "status": "generated",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "source_file_data": file_data,
        "wav_master": {"file": wav.name, "bytes": wav.stat().st_size, "sha256": sha256(wav)},
        "browser_asset": {"file": mp3.name, "bytes": mp3.stat().st_size, "sha256": sha256(mp3), "probe": probe},
        "processing": "WAV master preserved unchanged. MP3 browser copy: 120ms fade-in, 350ms fade-out at 59.65s, -3dB gain, stereo 44.1kHz libmp3lame VBR q3. Full MP3 decode passed.",
        "listening_review": "Not certified by a human listener; prompt adherence must be assessed by listening.",
    })
    print(f"Saved {mp3.name}: {mp3.stat().st_size} bytes", flush=True)


def generate(session, preset, record):
    data = [MODEL, preset["prompt"], 60, 8, 1.0, "pingpong", preset["seed"]]
    record["request"] = {"api_name": "/infer", "data": data}
    response = session.post(f"{SPACE}/gradio_api/call/infer", json={"data": data}, timeout=(15, 60))
    response.raise_for_status()
    event_id = response.json()["event_id"]
    record["event_id"] = event_id
    print(f"Queued {preset['name']} ({event_id})", flush=True)
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
                    finish_record(session, preset, record, value[0])
                    return
    raise RuntimeError("Official Space stream ended without a completed audio result")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="+", choices=PRESETS, default=list(PRESETS))
    parser.add_argument("--adopt-close", type=pathlib.Path, help="Import the already-completed first request's provenance JSON")
    args = parser.parse_args()
    ASSETS.mkdir(exist_ok=True)
    session = requests.Session()
    document = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {
        "model": "Stable Audio 3.0 Small SFX",
        "model_card": "https://huggingface.co/stabilityai/stable-audio-3-small-sfx",
        "provider": "Stability AI official public Hugging Face Space",
        "space": f"https://huggingface.co/spaces/{SPACE_REPO}",
        "license_reference": "https://huggingface.co/stabilityai/stable-audio-3-small-sfx/blob/main/LICENSE.md",
        "notes": "Genuine text-to-audio generation. No external field recording was supplied to the model. Small-SFX is part of the Stable Audio 3.0 family; there is no claim that these files used the older Stable Audio Open 1.0 model.",
        "assets": {},
    }
    info = session.get(f"https://huggingface.co/api/spaces/{SPACE_REPO}", timeout=(15, 30))
    info.raise_for_status()
    document["space_revision"] = info.json().get("sha")
    for key in args.only:
        if document["assets"].get(key, {}).get("status") == "generated":
            print(f"Keeping existing completed asset: {key}", flush=True)
            continue
        preset = PRESETS[key]
        record = {"prompt": preset["prompt"], "seed": preset["seed"], "duration_seconds": 60,
                  "sourceUrl": document["space"], "model": document["model"],
                  "modelLicense": "Stable Audio Community License", "modelLicenseUrl": document["license_reference"],
                  "steps": 8, "cfg_scale": 1.0, "sampler": "pingpong", "status": "queued",
                  "started_at": datetime.now(timezone.utc).isoformat()}
        document["assets"][key] = record
        try:
            if key == "close" and args.adopt_close:
                prior = json.loads(args.adopt_close.read_text())
                record["request"] = {"api_name": "/infer", "data": prior["request"]["data"]}
                record["event_id"] = prior["event_id"]
                finish_record(session, preset, record, prior["result"])
            else:
                generate(session, preset, record)
        except Exception as error:
            record["status"] = "failed"
            record["error"] = f"{type(error).__name__}: {error}"
            save_manifest(document)
            raise
        save_manifest(document)


if __name__ == "__main__":
    main()
