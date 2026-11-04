# Stable Audio wildfire assets

The main `burning-forest.mp3` is a new generated asset, made with **Stable Audio 3.0 Small SFX** through [Stability AI's official public Hugging Face Space](https://huggingface.co/spaces/stabilityai/stable-audio-3). It replaces the small-fire source as the main full-strength wildfire layer. It is a generated sound design, not a recording of a real wildfire.

The current model family is [Stable Audio 3.0](https://github.com/Stability-AI/stable-audio-3); Small SFX supports up to 120 seconds. “Stable Audio Open 3.0” was interpreted as this current open-weight SFX model. The older Stable Audio Open 1.0 model was not used.

## Main asset

`burning-forest.mp3` overlays three independent 60-second generations at linear amplitude weights **0.55 close / 0.28 middle / 0.17 distant**. This layers irregular events and different perspectives without timing, quantizing, or adding a beat. Each prompt requests intense chaotic forest fire, with roaring flames, irregular snaps, tree cracks, and ember gusts, excluding music, voices, animals, and insects.

The mixed source is peak-normalized before encoding and receives 120 ms fade-in and 350 ms fade-out boundary fades. There is no dynamics compression or pitch shifting. The file is stereo, 44.1 kHz, 160 kbps, 60 seconds of decoded audio, and **1,201,154 bytes**. The complete encoded file decodes successfully; its decoded peak is **−4.33 dBFS** and RMS is **−24.01 dBFS**. Technical checks do not certify perceptual prompt adherence.

SHA-256: `08ba2e8a08df10d3834970fe745df20f8c413dde7a38bed4473903eb8451283c`

## Preserved takes

| Perspective | Seed | Browser copy | Unchanged generated master |
| --- | --- | --- | --- |
| Close | 2026103101 | `stable-fire-close.mp3` | `stable-fire-close-space.wav` |
| Middle | 2026103102 | `stable-fire-middle.mp3` | `stable-fire-middle-space.wav` |
| Distant | 2026103103 | `stable-fire-distant.mp3` | `stable-fire-distant-space.wav` |

Every request used `small-sfx`, 60 seconds, 8 steps, CFG 1.0, and the `pingpong` sampler. Exact prompts, request data, returned file URLs, event IDs, timestamps, file hashes, and processing are preserved in `stable-audio-generation.json`. `burning-forest-source.json` describes the final mix and all three source takes. These records are separate from the app's root asset manifest.

Generation used official Space revision `a6d4a3300fb7d96b2f28ac409d868cba65eb6093`. A fourth request for quiet natural insects was refused because the anonymous ZeroGPU quota was exhausted. No generated insect file is claimed. The separately documented CC0 `crickets.mp3` remains the available quiet-state recording.

## Model and provenance

- [Official Small SFX model card](https://huggingface.co/stabilityai/stable-audio-3-small-sfx)
- [Stable Audio Community License supplied with the model](https://huggingface.co/stabilityai/stable-audio-3-small-sfx/blob/main/LICENSE.md)
- [Official Stable Audio 3 code](https://github.com/Stability-AI/stable-audio-3)
- [Official Apple Silicon MLX implementation](https://github.com/Stability-AI/stable-audio-3/tree/main/optimized/mlx)

No account, subscription, purchase, or paid API was used. An initial local route verified Apple M1 Pro / 16 GB, MLX 0.31.2, and available GPU support. The official runtime was cloned at commit `5f5e6ac21ae9ff78a6e8847eb7a1dcbe969ffb84`; the ungated optimized weights repository was observed at revision `30cb2644da54bfa63275d1bc7f1fa67fc718680f`. The slow local weight download was stopped after the public Space succeeded. These local weights were not used to produce the delivered assets.

## Reproduce

`python3 scripts/generate-stable-wildfire.py --only close middle distant` submits the recorded prompts to the official public Space. It requires `requests` and FFmpeg and may be subject to service quota or queue limits. Already completed assets are retained by default. A fixed seed and preserved request record do not guarantee identical future service weights.

`python3 scripts/generate-stable-wildfire-mix.py` verifies master hashes and rebuilds only the final main asset locally. It requires NumPy, SoundFile, and FFmpeg. It performs no network request.
