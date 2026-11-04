#!/usr/bin/env python3
"""Run the pinned official Stable Audio 3 Medium MLX pipeline in one process.

Text conditioning is computed once for the batch, then its model is freed.
One Medium DiT and one SAME-L decoder are reused sequentially for every clip.
No public service, account, API key, or paid credit is used for generation.
"""

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import gc
import hashlib
import importlib.util
import json
import math
import pathlib
import subprocess
import sys
import time

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "audio-assets" / "v3"
RECORD = ASSETS / "medium-batch.json"
RUNTIME_REVISION = "5f5e6ac21ae9ff78a6e8847eb7a1dcbe969ffb84"
WEIGHTS_REVISION = "30cb2644da54bfa63275d1bc7f1fa67fc718680f"
WEIGHTS = {
    "t5gemma_f16.npz": {"bytes": 567443068, "sha256": "8deb20489f36d9aec539f26c9c67321f99bc5fe300d470435ed6e76be4f16bbd"},
    "dit_medium_f16.npz": {"bytes": 2907300946, "sha256": "f9e5647ea3225818657d47d47ae4b34afa29c0568206ca89566c1a758944a38e"},
    "same_l_decoder_f32.npz": {"bytes": 1704311976, "sha256": "84924be2122d3a20fce443f40b782d9cd88e8e73707476326003ac47659a2287"},
}


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as data:
        for block in iter(lambda: data.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save(document):
    RECORD.write_text(json.dumps(document, indent=2) + "\n")


def prepare_weights(runtime, directory):
    target_directory = runtime / "models" / "mlx"
    target_directory.mkdir(parents=True, exist_ok=True)
    for name, expected in WEIGHTS.items():
        source = directory / name
        if not source.is_file() or source.stat().st_size != expected["bytes"]:
            raise RuntimeError(f"Required official model file is incomplete: {source}")
        if sha256(source) != expected["sha256"]:
            raise RuntimeError(f"Official model file hash mismatch: {source}")
        target = target_directory / name
        if target.is_symlink():
            target.unlink()
        if not target.exists():
            target.symlink_to(source)
        elif target.resolve() != source.resolve():
            raise RuntimeError(f"Refusing to overwrite unrelated runtime weights: {target}")
        print(f"Verified official weights: {name}", flush=True)


def load_runtime(runtime):
    script = runtime / "scripts" / "sa3_mlx.py"
    spec = importlib.util.spec_from_file_location("wildfire_official_sa3", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def free_cache(mx):
    gc.collect()
    clear = getattr(mx, "clear_cache", None) or getattr(mx.metal, "clear_cache", None)
    if clear:
        clear()


def decode(module, decoder, chunk_fn, chunk_config, latents):
    mx = module.mx
    latents = latents.astype(mx.float32)
    length = latents.shape[-1]
    chunk, overlap = chunk_config
    if length > chunk + 2 * overlap:
        patches = chunk_fn(decoder, latents, chunk, overlap)
    elif length % 2 == 0:
        patches = decoder(latents)
    elif length > 6:
        patches = chunk_fn(decoder, latents, 2, 2)
    else:
        even = mx.concatenate([latents, latents[..., -1:]], axis=-1)
        patches = decoder(even)[..., :length * 16]
    mx.eval(patches)
    audio = module.patched_decode(patches, patch_size=256, channels=2)
    mx.eval(audio)
    return np.array(audio.astype(mx.float32))[0]


def main():
    global RECORD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packs", type=pathlib.Path, nargs="+", required=True)
    parser.add_argument("--runtime", type=pathlib.Path, default=ROOT / ".audio-model-cache/runtime/optimized/mlx")
    parser.add_argument("--weights", type=pathlib.Path, default=ROOT / ".audio-model-cache/weights")
    parser.add_argument("--only", nargs="+")
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--include-probe", action="store_true")
    parser.add_argument("--wait-for-weights", action="store_true", help="Wait for the coordinated official downloads to finish")
    parser.add_argument("--record", type=pathlib.Path, default=RECORD, help="Keep retry batch provenance separate from the original batch")
    args = parser.parse_args()
    args.runtime = args.runtime.resolve()
    args.weights = args.weights.resolve()
    RECORD = args.record
    requests = []
    for pack_path in args.packs:
        pack = json.loads(pack_path.read_text())
        for preset in pack["assets"]:
            if args.only and preset["id"] not in args.only:
                continue
            requests.append({**preset, "durationSeconds": pack["durationSeconds"], "steps": pack["steps"],
                             "cfgScale": pack["cfgScale"], "sampler": pack["sampler"], "pack": str(pack_path)})
    if args.include_probe:
        requests.insert(0, {"id": "fire-medium-probe", "title": "Medium route probe", "role": "Diagnostic 5-second dry fire",
                            "prompt": "TrackType: SFX, Close dry fine continuous fire crackling over a warm low rushing flame bed, dense soft-edged irregular grain in flat outdoor acoustics. Length: 5 seconds.",
                            "seed": 2026103120, "durationSeconds": 5, "steps": 8, "cfgScale": 1.0, "sampler": "pingpong"})
    if args.plan:
        print(json.dumps(requests, indent=2))
        return
    if not requests:
        raise RuntimeError("No requested presets were selected")
    if any(r["cfgScale"] != 1 or r["sampler"] != "pingpong" for r in requests):
        raise RuntimeError("This reproducible batch implements only the official CFG1 pingpong path")
    ASSETS.mkdir(exist_ok=True)
    if args.wait_for_weights:
        print("Waiting for the three coordinated Medium weight downloads", flush=True)
        deadline = time.time() + 1800
        while not all((args.weights / name).is_file() and (args.weights / name).stat().st_size == info["bytes"] for name, info in WEIGHTS.items()):
            if time.time() >= deadline:
                raise TimeoutError("Medium weights did not complete within30minutes")
            time.sleep(2)
    with open("/private/tmp/wildfire-v3-metal.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prepare_weights(args.runtime, args.weights)
        module = load_runtime(args.runtime)
        mx = module.mx
        set_cache_limit = getattr(mx, "set_cache_limit", None) or getattr(mx.metal, "set_cache_limit", None)
        if set_cache_limit:
            set_cache_limit(512 * 1024 * 1024)
        document = {"model": "Stable Audio 3 Medium", "modelUrl": "https://huggingface.co/stabilityai/stable-audio-3-medium",
                    "sourceUrl": "https://github.com/Stability-AI/stable-audio-3/tree/" + RUNTIME_REVISION + "/optimized/mlx",
                    "license": "Stable Audio Community License",
                    "licenseUrl": "https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md",
                    "backend": "Official MLX local inference on Apple Silicon", "runtimeRevision": RUNTIME_REVISION,
                    "optimizedWeightsRepository": "https://huggingface.co/stabilityai/stable-audio-3-optimized",
                    "optimizedWeightsRevision": WEIGHTS_REVISION, "verifiedWeights": WEIGHTS,
                    "device": mx.device_info(), "startedAt": now(), "status": "conditioning", "assets": {}}
        save(document)
        text_encoder = module.T5Gemma.from_npz(str(args.weights / "t5gemma_f16.npz"))
        padding, seconds_embedder = module.load_conditioner_from_npz(str(args.weights / "dit_medium_f16.npz"), prefix="cond.")
        conditions = []
        for request in requests:
            embeddings, mask = text_encoder.encode([request["prompt"]], max_len=256)
            embeddings = module.apply_prompt_padding(embeddings.astype(mx.float16), mask, padding.astype(mx.float16))
            seconds = seconds_embedder(request["durationSeconds"]).astype(mx.float16)
            cross = mx.concatenate([embeddings, seconds], axis=1)
            global_condition = seconds[:, 0, :]
            mx.eval(cross, global_condition)
            conditions.append((cross, global_condition))
            print("Conditioned", request["id"], flush=True)
        del text_encoder, embeddings, mask
        free_cache(mx)
        max_length = max(math.ceil(r["durationSeconds"] * 44100 / 4096) for r in requests)
        print("Loading one Medium DiT for all clips", flush=True)
        dit, _ = module.load_dit("medium", T_lat=max_length, dtype=mx.float16, num_steps=8)
        print("Loading one SAME-L decoder for all clips", flush=True)
        decoder, chunk_fn, chunk_config = module.load_decoder("same-l", mx.float32)
        document["status"] = "generating"
        save(document)
        for request, (cross, global_condition) in zip(requests, conditions):
            identifier = request.get("generationId", request["id"])
            row = {**request, **{key: document[key] for key in ["model", "modelUrl", "sourceUrl", "license", "licenseUrl", "backend", "runtimeRevision", "optimizedWeightsRevision"]},
                   "generated": False, "status": "generating", "startedAt": now()}
            document["assets"][identifier] = row
            save(document)
            start = time.time()
            print("Generating", identifier, flush=True)
            length = math.ceil(request["durationSeconds"] * 44100 / 4096)
            noise = mx.random.normal((1, 256, length), dtype=mx.float16, key=mx.random.key(request["seed"]))
            schedule = module.build_pingpong_schedule(request["steps"], sigma_max=1, use_logsnr_shift=True)
            def model_fn(x, t):
                return dit(x, t, cross, global_condition, local_add_cond=None)
            latents = module.sample_flow_pingpong(model_fn, noise, schedule, seed=request["seed"] + 1)
            mx.eval(latents)
            audio = decode(module, decoder, chunk_fn, chunk_config, latents)
            audio = audio[..., :request["durationSeconds"] * 44100]
            if not np.all(np.isfinite(audio)):
                raise RuntimeError(f"Generated non-finite audio: {identifier}")
            wav = ASSETS / (identifier + "-master.wav")
            # Preserve the actual model output, including any values above
            # full scale. The official CLI's16-bit saver would hard-clip them.
            # The browser copies are normalized once from this float master.
            sf.write(str(wav), audio.T, 44100, subtype="FLOAT")
            row.update({"generated": True, "status": "generated", "completedAt": now(),
                        "generationSeconds": round(time.time() - start, 3),
                        "peakMetalAllocatedBytes": module._get_peak_mem_bytes(),
                        "unclippedGeneratorPeak": float(np.max(np.abs(audio))),
                        "unclippedGeneratorRms": float(np.sqrt(np.mean(audio.astype("float64") ** 2))),
                        "unclippedGeneratorAboveFullScaleFraction": float(np.mean(np.abs(audio) > 1)),
                        "unclippedGeneratorNearFullScaleFraction": float(np.mean(np.abs(audio) >= .999)),
                        "master": {"file": wav.name, "bytes": wav.stat().st_size, "sha256": sha256(wav)},
                        "processing": "Official pipeline output preserved as stereo44100Hz32-bit float WAV without clipping or normalization. No reverb, compression, mixing or post-effects added. Browser copy normalized separately.",
                        "listeningReview": "Technical validity checked. Perceptual prompt adherence requires audition."})
            (ASSETS / (identifier + "-generation.json")).write_text(json.dumps(row, indent=2) + "\n")
            save(document)
            print("Saved", wav.name, "in", row["generationSeconds"], "seconds", flush=True)
            del noise, schedule, latents, audio
            free_cache(mx)
        document.update({"status": "complete", "completedAt": now()})
        save(document)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if RECORD.exists():
            document = json.loads(RECORD.read_text())
            document.update({"status": "failed", "error": f"{type(error).__name__}: {error}", "failedAt": now()})
            save(document)
        raise
