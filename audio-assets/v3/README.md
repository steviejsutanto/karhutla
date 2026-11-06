# Fire, rain and a living night — catalog revision 18

All **51** audio entries and their full/mobile files retain their hashes.
The active rain and haze recordings have returned to the previous choices:

- Rain: `rain-natural-light` → `rain-storm-v23`.
- Haze: `haze-air-v23` / `haze-float-v23`, also restored as the final two
  choices in the six-recording haze extinction bank.
- Phone cricket: the new regular `cricket-steady-phone-v34` stays active;
  `phone.cricketLayers` remains empty so only one coherent bed plays.

The three revision 17 rain/air studies remain archived in the catalog with
all masters, encoded files and provenance intact. Main’s cricket bank,
orangutan and phone bird bank are unchanged. This revision changes source
selection only; no recordings were regenerated or modified.

# Revision 17 archive notes

The current catalog contains **51** assets. All 47 previous audio/mobile
files and original masters remain unchanged. The four new entries use
genuinely new local Stable Audio 3 Medium generations:

- `rain-canopy-heavy-v34`: 24 s stereo / 577 kB, plus a 15 s mono / 121 kB
  derivative. This replaces the heavy Main rain endpoint; natural light and
  phone rain remain selected as before.
- `haze-calm-air-v34` and `haze-calm-drift-v34`: independent 20 s stereo /
  401 kB calm arrival textures, each with a 15 s mono / 121 kB derivative.
  Both arrival haze endpoints now use these sources.
- `cricket-steady-phone-v34`: one 14.6175 s mono / 177 kB regular phone bed
  arranged from 16 distinct notes in a new generated cricket master. Its
  existing 0.76× playback gives roughly 1.2 s between notes. Main’s cricket
  bank and the revision 16 phone bird bank remain unchanged.

The rain/air copies use fixed filters/gain and actual-source circular
crossfades; they do not add thunder, synthesized filler, reverb, compression
or envelope riding. Rain has about a 0.97 dB one-second RMS range. Haze is
about −36.4 dBFS RMS with low wind weight removed. No model runs on phones.
These remain synthetic interpretations, not verified field recordings, and
signal/provenance checks do not replace audition.

The three unfiltered source-preview MP3s are in
`output/audio-preview/*-v34-source-preview.mp3` at the project root. They
use only fixed audition gain and one encode. Performance copies are the
catalog files above. See `backgrounds-v34-validation.json`, the source
JSONs and `../ATTRIBUTION.md` for exact choices, excluded takes and hashes.

To reproduce the new generations and browser derivatives:

```sh
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v34-backgrounds-prompts.json scripts/stablegen-v34-steady-cricket-prompts.json --record audio-assets/v3/medium-backgrounds-v34-batch.json
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v34-backgrounds-retry-prompts.json --record audio-assets/v3/medium-backgrounds-v34-retry-batch.json
python3 scripts/finish-steady-phone-cricket-v34.py
python3 scripts/finish-backgrounds-v34.py
```

# Revision 16 archive notes

The current catalog contains **47** assets. Two compact soft flute-like coos
join the active phone bank with `rainforest-chirp-c-v31`. The old 45 encoded
and mobile files, all original masters, and Main’s orangutan audio remain
unchanged. The active bank is:

- `rainforest-coo-a-v32`: 1.4584 s, 12,428 bytes; active about 0.11–1.16 s.
- `rainforest-coo-b-v32`: 1.4584 s, 12,428 bytes; active about 0.23–1.19 s.
- `rainforest-chirp-c-v31`: the retained 0.67 s short chirp.

The new coos derive from the original independent low-bird generated
masters, with a baked +9-semitone rate lift, smooth edges and offline
450 Hz / 3000 Hz filtering. They are not new model generations and do not
use Main’s voice as a source. Whole-file playback stays at 1× with no model
or pitch DSP on phones. Mono 32 kHz / 64 kbps keeps each new file about
12.4 kB. Static RMS is about −30.6 dBFS and peak about −20.45 dBFS.

Measured coo dominants are 694/648 Hz, above Main’s 342 Hz dominant and
442 Hz 95%-energy ceiling. This separation is a signal measurement, not
a listening review or species certification. The synthetic source and
original generation license/provenance are retained honestly.

Rebuild the offline derivatives without new inference:

```sh
python3 scripts/finish-rainforest-coos-v32.py
```

Source chains and decoded measurements are in
`rainforest-coo-*-v32-source.json`, `rainforest-coos-v32-validation.json`
and `../ATTRIBUTION.md`.

# Revision 15 archive notes

The current catalog contains **45** assets. Three new short synthetic bird
chirps replace the low coo choices for phone wildlife. The old 42 files,
including Main’s orangutan recording, retain their hashes and provenance.

The current phone bank is `rainforest-chirp-a-v31`,
`rainforest-chirp-b-v31`, `rainforest-chirp-c-v31`: one measured clear
mid-register burst per file, 0.60/0.61/0.67 seconds including quiet edges,
mono 32 kHz / 64 kbps, around 5.5–6.1 kB. Whole source generations are not
played: the finisher isolates one short chirp from each independent master.
Dominant measured frequencies are about 3.0/2.8/2.2 kHz, instead of the old
low coo register. These remain synthetic creative interpretations rather than
species-certified field recordings; no human listening review is claimed.

To reproduce the new master generations and selected derivatives:

```sh
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v31-rainforest-chirps-prompts.json --record audio-assets/v3/medium-rainforest-chirps-v31-batch.json
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v31-rainforest-chirps-retry-prompts.json --record audio-assets/v3/medium-rainforest-chirps-v31-retry-batch.json
python3 scripts/finish-rainforest-chirps-v31.py
```

All former master files and records stay unchanged. Full details are in
`rainforest-chirps-v31-validation.json`, the new `*-v31-source.json` files
and `../ATTRIBUTION.md`. No model inference runs on phones.

# Revision 14 archive notes

The revision 14 catalog had **42** browser assets. Revision 14 adds three
original synthetic wildlife phrases for the finale: a restrained distant
orangutan interpretation on Main and two short warm low bird phrases for
sparse distribution across phones. These are sound design interpretations,
not authentic field recordings or claims about actual animal emotion.

The orangutan file is 16 seconds, mono 32 kHz / 80 kbps (161 kB). Each bird
file is 2.8 seconds, mono 32 kHz / 64 kbps (23 kB). Filtering, fades, mono
downmix and fixed gain happen offline. No model runs on phones or during
a performance. Exact processing, independent prompt/seed records, master
and encoded hashes, and full-decode results are in the `*-v25-source.json`
and generation files, `medium-wildlife-v25-batch.json`,
`medium-wildlife-v25-retry-batch.json`, and `wildlife-v25-validation.json`.
Technical checks do not replace listening review. See `../ATTRIBUTION.md`
for the selected master excerpts and license details.

To reproduce using the already installed official local pipeline:

```sh
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v25-orangutan-prompts.json scripts/stablegen-v25-birds-prompts.json --record audio-assets/v3/medium-wildlife-v25-batch.json
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v25-birds-retry-prompts.json --record audio-assets/v3/medium-wildlife-v25-retry-batch.json
python3 scripts/finish-wildlife-v25.py
```

## Revision 6 archive notes

The active `manifest.json` now contains **19** browser assets: the 14 retained
Stable Audio 3 Medium sounds plus two natural rain excerpts and three natural
cricket recordings. Existing `audio-assets/v3/` URLs are preserved. Model
output and CC0 field recordings have distinct source records and labels.

The performance uses the new 40-second `rain-natural-light` and
`rain-natural-steady` endpoints. These are non-overlapping passages of
[EduFigueres' countryside rain, Freesound #688896](https://freesound.org/people/EduFigueres/sounds/688896/),
not two independent recordings. Both preserve the same fixed +16 dB gain,
without added compression, AGC, limiting, denoise, or envelope riding. Their
only time-varying export treatment is a 5 ms click guard at each boundary;
the runtime prepares circular overlap rather than repeated long gain fades.
Upstream processing is not disclosed, so no claim is made that the source
is an untouched microphone master.

`cricketLayers` selects three independent natural recordings simultaneously:

| Layer | Recording | Excerpt |
| --- | --- | --- |
| `cricket-near` | [Night Crickets 02, Vrymaa #805466](https://freesound.org/people/Vrymaa/sounds/805466/) | 22–58 s, 36 seconds, mono |
| `cricket-mid` | [Crickets At Night - Clean sound, Defelozedd94 #522298](https://freesound.org/people/Defelozedd94/sounds/522298/) | 52–92 s, 40 seconds, stereo |
| `cricket-far` | [Crickets - Warm Summer Night, Speziax #645329](https://freesound.org/people/Speziax/sounds/645329/) | 17–57 s, 40 seconds, stereo |

The close excerpt avoids the sharp broadband events around source seconds
16–21. Cricket exports use only an 1800 Hz two-pole high-pass, fixed gain,
5 ms click guards, and 192 kbps MP3 encoding at 44.1 kHz. No cricket rhythm,
pitch shift, synthetic pulse or extra audio layer is baked into the files.
The creator of the middle recording applied Audacity noise removal; the
distant recording's creator reports only original gain. The phone retains
its compact generated `crickets-pulse-mobile` asset. The previous generated
cricket pair and generated rain endpoints remain in the catalog as alternate
assets, with their original provenance and unchanged masters.

All four selected source recordings are
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/),
verified from primary Freesound pages on 1 November 2026. The downloads are
public HQ MP3 previews; login-only original WAVs were not downloaded. Exact
preview URLs, retained preview/page hashes, excerpts, constant gain, browser
hashes and measured levels are recorded per asset in `*-source.json`.
The retained previews and source-page snapshots are in `natural-sources/`.
Rejected soft-rain #640655 and cricket #320145 previews remain there for
selection traceability but are excluded from the catalog and ZIP.

Every new browser file passed complete decoding, finite-sample, exact
content-length and encoded peak checks (no higher than −3 dBFS).
`natural-assets-validation.json` records envelope variation and limitations.
Waveform, spectrogram and signal checks support the selections; these do
not certify every background sound or replace a listening review.

To rebuild the new field-recording derivatives from the retained previews
and republish the complete catalog:

```sh
python3 scripts/finish-natural-assets-v6.py
python3 scripts/publish-sound-library.py
```

The ZIP includes the 19 published assets and compact phone derivatives,
their source records, catalog, attribution, current documentation, generation
records and validation. It also includes the selected unchanged public
previews and source-page snapshots under `natural-sources/`. Large model
masters and model weights remain outside the ZIP. The unselected branch/leaf
take remains under `audition/`.

## Revision 5 archive notes

The following notes describe the retained Medium-only revision 5 palette.
Revision 6 selection and source details above take precedence.

The published assets were genuinely generated locally with **Stable Audio 3
Medium**, using Stability AI's pinned official MLX implementation and the
same three SHA-256-verified official model files. The catalog revision is 5;
the established `audio-assets/v3/` URLs stay stable. The earlier Small-SFX
recordings remain separately in `audio-assets/`.

The active catalog contains 14 assets: the three existing forest-fire
directions, a new branches-and-leaves phone texture, and ten 45-second
palette endpoints:

| Layer | Lower endpoint | Upper endpoint |
| --- | --- | --- |
| Haze | `haze-light` — light air | `haze-drift` — more drifting air |
| Ash | `ash-fine` — delicate sifting | `ash-scatter` — fuller scattering |
| Rain | `rain-light` — fine patter | `rain-steady` — steady water |
| Moisture | `moisture-seep` — quiet seep | `moisture-trickle` — gentle trickle |
| Aftermath insects | `crickets-pulse` — repeated calls | `crickets-chorus` — alternate call pattern |

Each endpoint is an independent genuine model generation with a distinct
documented seed and prompt. The generated float masters remain unchanged and
unclipped. The two ash browser copies retain the full generated bandwidth,
without the earlier ash's low-pass treatment or phase-offset layering. Haze
derivatives remove low rumble with a 180 Hz high-pass. Rain and moisture use
documented fast 3:1 compression to soften isolated drop attacks; their pitch
and speed are unchanged. Cricket derivatives remove low background rumble
with an 1800 Hz high-pass. Asset-specific source JSON is authoritative for
all treatment and measurements, including any later documented refinement.

Browser copies have documented boundary click guards or short fades, conservative peak normalization,
and stereo 44.1 kHz MP3 encoding: 320 kbps for both clear ash endpoints,
160 kbps for the other desktop assets. Every MP3 is decoded completely
and checked for finite samples and a measured peak no higher than -3 dBFS.
These signal checks do not establish perceptual prompt adherence or replace
listening. The source records explicitly distinguish model output from
processed derivatives, and do not claim human listening certification.

The phone's active crackle is `phone-branches-leaves` — **Branches and
leaves**. Two independent 45-second Medium takes requested fine dry burning
twigs and papery leaf crackle. Take 2 was selected after comparing their
signal measurements: less sub-500 Hz energy than the previous ember source
and steadier activity than take 1. These comparisons support selection but
do not certify perceived source identity or dryness. Both original float
masters and generation records are retained unchanged.

The branch/leaf desktop copy is 45 seconds, stereo 44.1 kHz, 160 kbps. Its
phone copy selects raw seconds 8–26 directly from the float master, mono
44.1 kHz, 96 kbps, giving an 18-second excerpt without a second lossy encode.
Both receive only conservative peak normalization and 5 ms click guards at
each edge; no filtering, compression, layering or long export fades are
applied. The phone runtime prepares a circular overlap at playback. The
cricket phone copy remains unchanged: seconds 8–23 of the published browser
copy, mono 22.05 kHz, 64 kbps, with its documented 120/300 ms fades. These
compact copies are derivatives, not additional model generations. Exact
hashes, sizes, treatment and measured levels appear in `mobile` metadata.

The previous `phone-crackle` source remains archived on disk with its old
MP3, mobile MP3, float master and provenance; it is excluded from the 14
active choices. The unselected `phone-branches-leaves-take1.mp3` remains
available for optional audition, also excluded from the active catalog.

`manifest.json` is the active catalog. Its `morphs`, `aftermath`, and `phone`
fields identify which assets the performance uses. Earlier palette studies
`haze`, `ash`, `rain`, `moisture`, and `crickets` are retained on disk with
their provenance, and excluded from the active choices. Early rejected fire
and ash takes also remain archived under `rejected/`. Superseded new haze
and fine-ash takes retain their original float masters and generation JSONs;
their early browser copies and source records are archived under `rejected/`.

Every `*-source.json` records the actual model, exact prompt and seed,
completed generation, source and browser-file SHA-256, explicit processing,
and measured signal properties. `medium-palette-batch.json` preserves the
new local run; `medium-palette-retry-batch.json` and
`medium-ash-retry-batch.json` preserve replacement takes. `medium-batch.json`
and `medium-retry-batch.json` preserve earlier runs. `palette-generation.json`
aggregates the palette finishing records. `medium-branches-leaves-batch.json`
and `branches-leaves-finishing.json` record the two phone replacements,
selection and exports. `branches-leaves-validation.json` records the take
comparison, final mobile/desktop measurements and retained earlier hashes.
The ZIP contains the 14 published MP3s (including phone derivatives), their
provenance, catalog, attribution, model-research record and this README. The
unselected branch/leaf take and its provenance are under `audition/`; that
folder is outside the active catalog. Large float masters
and model weights remain outside the ZIP.

The pinned official runtime and approximately 5.18 GB of weights are retained
permanently inside the project at `.audio-model-cache/`. A previously documented
temporary cache had been cleared, so this revision restores and verifies the
same official files. No generation or model download happens during a performance.

To reproduce the new generations using the saved local environment:

```sh
python3 scripts/restore-medium-weights.py
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v4-palette-prompts.json --record audio-assets/v3/medium-palette-reproduction-batch.json
python3 scripts/stablegen-v4-palette-finish.py --mobile
python3 scripts/stablegen-v3-local-batch.py --packs scripts/stablegen-v5-branches-leaves-prompts.json --record audio-assets/v3/medium-branches-leaves-batch.json
python3 scripts/stablegen-v5-branches-leaves-finish.py --select take2
python3 scripts/validate-medium-palette.py
python3 scripts/publish-sound-library.py
```

The batch runner defaults to the retained runtime and weights in
`.audio-model-cache/`. Local MLX inference needs access to the Mac's graphics
processor. The restoration script only downloads the exact pinned official
files and rejects an incorrect full-file hash.

Official references and attribution:

- Model and weights: [Stability AI — Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium)
- Code: [Pinned official MLX implementation, revision 5f5e6ac](https://github.com/Stability-AI/stable-audio-3/tree/5f5e6ac21ae9ff78a6e8847eb7a1dcbe969ffb84/optimized/mlx)
- Optimized weights: [Pinned release 30cb264](https://huggingface.co/stabilityai/stable-audio-3-optimized/tree/30cb2644da54bfa63275d1bc7f1fa67fc718680f)
- License: [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md)

All delivered v3/v4/v5 catalog sounds came from local Medium inference. Earlier
hosted-demo attempts failed because of quota and are recorded as failures;
they are not credited as successful generations. No paid service or new
account is used for this palette.


Phone rhythm revision v30 retains all source recordings and publishes three
compact derivatives: `cricket-{far,mid,near}-mobile-rhythm-v30.mp3`. Run
`python3 scripts/finish-phone-crickets-v30.py` to reproduce the deterministic
25% onset-spacing increase and 35% note-envelope shortening. Individual
waveforms preserve pitch; the active mobile mappings select the new files.
Complete source and edit records are beside the MP3s;
`phone-crickets-v30-validation.json` records full decode and timing metrics.
