# Sound sources

## Current catalog — revision 13

Revision **13** contains **39 browser assets**. Four new short liquid
blob one-shots are listed in `main.blob` for individual newly extinguished
patches on Main. They use the separate `blob` kind. The existing 35 audio
files, hashes, catalog metadata, phone selections and global morphs are
retained unchanged.

Four independent 5-second sources were generated locally on **4 November
2026** (local date) with the cached pinned official
[Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium)
MLX pipeline and the same verified official model weights. Distinct
prompts/seeds 202611042401–202611042404 request short soft rounded warm
resonant liquid bubble/plop events, with a brief organic attack and
restrained upper detail. Each browser sound uses a separate actual event
from its own unchanged original float master. No existing quench sound,
external recording, synthesized substitute, time/pitch transformation,
copied-offset variation or layered copy supplies these new events.

| Browser one-shot | Original master excerpt | Exact published length |
| --- | --- | --- |
| `v3/extinction-blob-a.mp3` | `extinction-blob-a-master.wav`, 0–0.72 s | 0.72 s / 31,752 samples |
| `v3/extinction-blob-b.mp3` | `extinction-blob-b-master.wav`, 0.08–0.73 s | 0.65 s / 28,665 samples |
| `v3/extinction-blob-c.mp3` | `extinction-blob-c-master.wav`, 0–0.70 s | 0.70 s / 30,870 samples |
| `v3/extinction-blob-d.mp3` | `extinction-blob-d-master.wav`, 0.66–1.26 s | 0.60 s / 26,460 samples |

Each excerpt receives a 90 Hz two-pole high-pass, a 2600 Hz two-pole
low-pass, broad +2 dB 450 Hz / 1.5-octave equalization, a 12 ms onset
guard and 180 ms ending taper. The derivative is mono 44.1 kHz / 96 kbps
MP3 encoded directly from processed float. Only fixed gain is used,
toward −27 dBFS RMS constrained to a −11 dBFS encoded peak ceiling;
the actual decoded peaks are approximately **−12.4 dBFS**. Event lengths
include quiet tails, so whole-clip RMS values range from approximately
−33.0 to −36.0 dBFS. No compression, AGC, limiting, gating, reverb,
echo or extra noise is applied. The Main one-shot metadata has explicit
short boundaries; the same file is exposed as its catalog mobile
derivative for format consistency, while `main.blob` supplies its routing.

All four outputs fully decode to their exact expected sample counts,
with zero nonfinite samples and conservative encoded peaks. Raw and
processed float files are retained with SHA-256 hashes.
`v3/medium-blob-v24-batch.json`, each new `*-generation.json` and
`*-source.json`, and `v3/blob-v24-validation.json` retain exact prompts,
seeds, pinned runtime/model revisions, verified model-weight hashes,
device, event sample ranges, processing, original/output hashes,
whole-short-clip spectral measurements and decode checks. The sounds
remain under the [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md).
Signal and provenance checks do not claim human listening review or
semantic certification of liquid identity or absence of voices/music.

## Retained catalog — revision 12

Revision **12** contains **35 browser assets**. It adds two new heavy-rain
storm derivatives and two new independent airy haze recordings. The main
rain morph now retains `rain-natural-light` at its quiet end and uses
`rain-storm-v23` at its heavy end. `rain-storm-v23-study2` is a retained
storm alternative. Main haze now morphs between `haze-air-v23` and
`haze-float-v23`; all older haze and rain choices, files, licenses and
provenance remain available. All 31 previously published audio files and
their catalog metadata passed unchanged SHA-256 checks. The phone keeps
the original thin `phone-branches-leaves` and the retained natural
`rain-natural-light`; its selections and audio are unchanged.

Six independent 30-second masters were genuinely generated locally on
**3 November 2026** using the cached pinned official
[Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium)
MLX pipeline and the already verified official model weights. Two initial
storm takes supplied actual deep rolling thunder, two additional heavy
rain studies supplied sustained natural rain beds, and two separate haze
prompts/seeds supplied thin floating textures. Every unchanged raw float
master is retained with its exact hash. No externally sourced audio,
synthesized substitute, time/pitch alteration, or copied-offset layer was
used to make these new assets.

The default storm combines all 30 seconds of `rain-downpour-v23-bed2`
with actual generated thunder seconds **6.5–14.5** from
`rain-storm-v23-study2-master.wav`, explicitly placed at output seconds
**10–18**. The alternative combines `rain-downpour-v23-bed1` with actual
thunder seconds **2–11** from `rain-storm-v23-master.wav`, placed at
**10–19**. The model did not put its strongest bass roll exactly halfway;
this central placement is an editorial choice, not a claim of model time
control. Rain receives fixed gain only, preserving its generated natural
envelope with no compression, AGC, limiting, gating or envelope riding.
The thunder excerpt receives a 35 Hz high-pass, 1400 Hz low-pass,
broad +4 dB 120 Hz equalization, an 800 ms fade-in and 2 s ending taper;
both components use documented fixed gains and sum without automatic mix
normalization. The low-pass reduces sharp upper cracks while the
equalizer supports the existing generated low rolling body.

The default storm's decoded MP3 measures **−29.05 dBFS RMS** and
**−5.29 dBFS peak**. Its actual strongest consecutive three-second
80–200 Hz region is **12–15 s**: that band accounts for approximately
**40.4%** of event energy and rises **9.1 dB** above the non-event
low-band baseline. Across the full file, 80–200 Hz accounts for
approximately **22.7%** of spectral energy. These are objective signal
measurements, not human thunder annotations or perceptual certification.

Each new haze derivative uses only a 280 Hz two-pole high-pass to remove
low weight, a quieter fixed level near **−34.3 dBFS RMS**, and short
boundary guards. Fine upper bandwidth remains available, with no
compression, low-pass, lo-fi treatment, added noise or effects. The two
independent new haze choices also join the retained localized haze
variations. Their measured energy below 200 Hz is negligible; this does
not independently certify their perceived identity as haze.

The four new main copies are 30-second stereo 44.1 kHz / 192 kbps MP3s;
their compact copies are direct processed-float seconds 6–24, mono
44.1 kHz / 96 kbps. Both receive 5 ms boundary guards and fixed gain with
decoded peak checks. No MP3-to-MP3 transcode is used. Every file fully
decodes to the exact expected sample count with zero nonfinite samples.
`v3/medium-storm-haze-v23-batch.json`,
`v3/medium-rain-bed-v23-batch.json`, each `*-generation.json` and
`*-source.json`, and `v3/storm-haze-v23-validation.json` record exact
prompts, seeds, model/runtime revisions, device, model-weight hashes,
master and derivative hashes, component gains, event timing, band
measurements, and decode/headroom results. The generated sources remain
under the [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md),
separate from the CC0 field recordings below. No human listening review
or semantic guarantee of absence of voices/music is claimed.

## Retained catalog — revisions 10–11

Revision 11 changes the phone default back to the original thin `phone-branches-leaves` recording. All 31 audio files, generated masters, hashes and licenses are retained unchanged from revision 10. The following revision 10 details describe that earlier catalog state.

The active `audio-assets/v3/manifest.json` contains **31 browser assets**.
Revision 10 adds one new dry branch/leaf phone crackle and six independent
generated residue variations: two fine ash, two subtle moisture, and two
lightweight air/haze textures. The original choices, source files, and
two-endpoint global morph definitions remain available. The separate
`residueVariations` lists each contain the two retained endpoints plus two
genuinely new alternatives for concurrent localized residue patches.

All new source material was genuinely generated locally on **3 November
2026** using the cached [Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium)
model, the pinned official MLX runtime, and the same verified official
optimized weights documented below. Eight initial independent 30-second
generations made two phone studies and six residue studies. Two additional
30-second phone studies tested fuller wooden prompts. The selected phone
texture uses the first dry branch/leaf generation alone. The other three
phone masters remain unchanged for optional review. No external recording,
synthesized substitute, copied offset, pitch shift, speed change, or repeated
layering was used to produce extra variations.

`phone-branches-dry-v20` is the phone default, with the preceding
`phone-branches-full` and `phone-branches-leaves` retained in
`phone.crackleAlternatives`. Its derivative removes low weight with a
220 Hz high-pass, supports clear middle-frequency detail with a broad
1050 Hz lift, and restrains high-frequency/spike prominence with a 6500 Hz
low-pass and soft compression. It does not use the preceding texture's
two-take blend. The compact mono copy measures approximately −30.9 dBFS
RMS and −7.7 dBFS peak. Its energy below 500 Hz is approximately 0.4%,
versus 26.6% in the previous fuller phone blend; energy from 500 Hz to
2 kHz is approximately 24.6%, versus 15.8% in that blend. These measurements describe
signal balance, not a perceptual guarantee of source identity or dryness.

The ash variants retain the full generated bandwidth with no frequency
filtering, layering, or lo-fi treatment; soft 2:1 compression restrains
isolated flake spikes. Moisture uses gentle fast 3:1 compression to soften
isolated water onsets. Haze uses a 180 Hz high-pass to remove rumbling weight
and gentle 3:1 compression to restrain isolated gust spikes. Each class uses
documented fixed gain and conservative encoded peak checks to maintain
consistent practical levels. No reverb, delay, added music, or extra noise
was applied.

Every selected asset has a 30-second stereo browser copy encoded at
44.1 kHz / 160 kbps (ash at 320 kbps), and an **18-second mono 44.1 kHz /
96 kbps** mobile copy taken directly from processed float seconds 6–24.
Both receive only 5 ms boundary guards in addition to their documented
treatment and fixed normalization. Mobile files are encoded directly from
float audio, without MP3-to-MP3 re-encoding. Unchanged raw float masters,
processed float derivatives, exact prompts/seeds, device and pinned model
details, model-file hashes, output hashes, and complete decode/headroom
measurements are retained in `v3/*-generation.json`, `v3/*-source.json`,
`v3/medium-residue-v20-batch.json`, and
`v3/medium-wood-v20-retry-batch.json`.

The existing `rain-natural-light` also has a new 18-second mono 44.1 kHz /
96 kbps mobile derivative, selected by `phone.rain`. It uses retained
Freesound #688896 preview seconds 54–72, equivalent to published light-rain
seconds 8–26, with the original fixed +16 dB export gain and 5 ms guards.
It is encoded directly from the unchanged retained original public preview;
the existing browser rain and base provenance remain unchanged. No added
compression, AGC, limiting, filtering, gating, or envelope riding is used.
The mobile copy measures −32.8 dBFS RMS and −12.6 dBFS peak. Its separate
`v3/rain-natural-light-mobile-source.json` and
`v3/phone-rain-v20-validation.json` preserve the CC0 source, exact excerpt,
fixed processing, final hash, and complete decode/peak checks.

`v3/residue-v20-validation.json` records complete decoded sample counts,
zero nonfinite samples, conservative peak checks, unchanged master hashes,
and pairwise waveform correlations across all four choices in each residue
class. The low waveform correlations are a copied-signal diagnostic;
perceptual diversity and prompt adherence still require listening review.
No human listening certification is claimed. All new generated sources use
the [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md).
No model request or sound generation occurs during a performance.

## Retained phone sources — revision 9 history

The active catalog is `audio-assets/v3/manifest.json`, revision **9**, with
24 browser assets. Revision 9 adds four short generated water-on-woodfire
quench sounds, a fuller generated phone branch/leaf bed, and compact mono
derivatives of the three existing natural cricket recordings. Existing
browser files, natural recording provenance and the earlier phone texture
are retained unchanged.

The new sounds were genuinely generated locally on **2 November 2026**
with [Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium),
the same pinned official MLX runtime and verified official optimized
weights documented below. Eight independent new float WAV masters were
made: four initial 8-second quench studies, two 30-second branch/leaf takes,
and two further 5-second quench studies. Two initial quench studies were
overly sparse in signal measurements; the final ember and wood variants use
the later independent generations. Every raw master and completed generation
record is retained, including the unselected studies. No external recording
or procedurally synthesized substitute is presented as a model output.

The four active `phone-quench-*.mp3` files are distinct **1.95, 2.10, 2.25
and 2.40-second** mono excerpts. They receive 160 Hz high-pass and 6800 Hz
low-pass filtering, soft compression to restrain isolated model spikes,
a 12 ms attack click guard, a 520 ms ending taper, and fixed gain before
44.1 kHz / 96 kbps MP3 encoding. Their decoded RMS levels are approximately
−28.4 to −29.2 dBFS, with peaks below −10 dBFS. They have no added reverb,
delay, music, external sound or synthesized noise. They are derivatives of
generated source audio, not untouched model output or field recordings.

`phone-branches-full` was the revision 9 phone crackle default. Its 18-second bed
mixes two independent generated branch/leaf takes, with a quieter second
take filling spaces between the first take's woody snaps. Documented
filtering, a broad middle-frequency lift, soft compression, fixed gain and
5 ms boundary click guards make a fuller, gentler texture. Stereo 160 kbps
and mono 96 kbps copies are encoded independently from the processed float
signal at 44.1 kHz. The mobile derivative measures −30.8 dBFS RMS and
−8.1 dBFS peak. Its energy below 2 kHz is approximately 42.4%, compared with
0.31% in the retained earlier phone texture; energy above 6 kHz falls from
83.4% to 21.6%. These measurements describe signal balance, not a perceptual
listening certification.

`cricket-far-mobile.mp3`, `cricket-mid-mobile.mp3` and
`cricket-near-mobile.mp3` each contain 18 seconds from the corresponding
existing published CC0 field-recording asset, starting at published seconds
11, 8 and 4 respectively. Mono 44.1 kHz / 96 kbps encoding and 5 ms boundary
click guards are their only additional treatment; no additional gain was
needed. These compact files inherit the original preview-source provenance
and original high-pass treatment documented in revision 6 below. No new
cricket generation or source download occurred. Separate
`cricket-*-mobile-source.json` records retain exact base hashes, excerpts,
creator/license references, output hashes and validation, while the base
audio and base provenance files remain unchanged.

`v3/medium-phone-v18-batch.json` and
`v3/medium-quench-v18-retry-batch.json` record exact prompts, seeds, pinned
model revisions, device details, verified model-file hashes and unchanged
master hashes. Each new `*-source.json` records complete processing,
generation provenance and final hashes. `v3/phone-v18-validation.json` and
`v3/phone-crickets-v18-validation.json` record exact complete decode/sample
counts, zero nonfinite samples and conservative encoded peak checks.
Signal checks do not certify perceptual source identity, dryness, or absence
of unwanted musical/vocal content; no human listening certification is claimed.

All new generated sources remain under the
[Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md),
separate from the CC0 natural field recordings. The cached model was used
offline; no sound generation or model download occurs during performance.

## Retained natural sources — revision 6 history

Revision **6** of `audio-assets/v3/manifest.json`
contained 19 browser assets: the 14 retained Medium assets from revision 5,
two new natural rain excerpts, and three natural cricket recordings. The
rain morph now uses `rain-natural-light` and `rain-natural-steady`; the main
cricket bed uses `cricket-near`, `cricket-mid`, and `cricket-far` together.
The prior generated rain and cricket endpoints remain available with their
unchanged masters and provenance. The compact phone cricket is unchanged.

The new natural assets were fetched on **1 November 2026** from public
Freesound HQ MP3 previews. Each primary source page identifies the sound as
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Original WAV files require login and were not downloaded. The compressed
previews and page snapshots are retained unchanged under `v3/natural-sources/`.

| Current local file | Source and creator | Excerpt | Our processing |
| --- | --- | --- | --- |
| `v3/rain-natural-light.mp3` | [Soft rain in the countryside](https://freesound.org/people/EduFigueres/sounds/688896/) by EduFigueres, #688896 | 46–86 s | Fixed gain; 5 ms boundary click guards; stereo 44.1 kHz / 192 kbps MP3 |
| `v3/rain-natural-steady.mp3` | [Soft rain in the countryside](https://freesound.org/people/EduFigueres/sounds/688896/) by EduFigueres, #688896 | 4–44 s | Fixed gain; 5 ms boundary click guards; stereo 44.1 kHz / 192 kbps MP3 |
| `v3/cricket-near.mp3` | [Night Crickets 02](https://freesound.org/people/Vrymaa/sounds/805466/) by Vrymaa, #805466 | 22–58 s | 1800 Hz two-pole high-pass; fixed gain; 5 ms guards; mono 44.1 kHz / 192 kbps MP3 |
| `v3/cricket-mid.mp3` | [Crickets At Night - Clean sound](https://freesound.org/people/Defelozedd94/sounds/522298/) by Defelozedd94, #522298 | 52–92 s | 1800 Hz two-pole high-pass; fixed gain; 5 ms guards; stereo 44.1 kHz / 192 kbps MP3 |
| `v3/cricket-far.mp3` | [Crickets - Warm Summer Night - Ambient.wav](https://freesound.org/people/Speziax/sounds/645329/) by Speziax, #645329 | 17–57 s | 1800 Hz two-pole high-pass; fixed gain; 5 ms guards; stereo 44.1 kHz / 192 kbps MP3 |

The two rain files are non-overlapping passages of **one** field recording,
not independent recordings. Both use the same fixed +16 dB export gain,
preserving the fuller passage's greater natural level. Our treatment adds no compression, automatic
gain control, limiting, noise gate, dynamic denoise, or envelope riding.
Upstream rain processing is not disclosed by its creator, so the original
is not claimed to be an untouched microphone master. The three cricket
sources are independent recordings with different call patterns and
perspectives. Defelozedd94 reports Audacity background-noise removal in the
published source; Speziax reports only about +6.3 dB of original gain. Our
cricket high-pass removes low background wash without imposing a call rhythm.

Every new `*-source.json` records the creator, exact source and preview
URLs, CC0 license, retained preview/page hashes, excerpt, constant gain,
encoding, final hash, complete decode and peak checks. Browser exports have
a verified peak no higher than −3 dBFS. `v3/natural-assets-validation.json`
records rain envelope variation, cricket envelopes and source-selection
limitations. Waveform and spectrogram inspection plus signal measurements
informed selection; no human listening certification is claimed. The rain
selection avoids the sparse sharp drops in rejected #640655; cricket
#320145 was excluded for broad transients and background wash.

Historical source notes: the Freesound recordings below were downloaded on 31 October 2026 from public high-quality MP3 preview links. Original-file downloads require Freesound login, so this prototype uses compressed preview audio. The generated forest-fire bed has separate provenance and model-license information below.

The five Freesound recordings are [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is supplied for provenance and courtesy.

| Local file | Original sound and creator | Source excerpt | Processing |
| --- | --- | --- | --- |
| `audio-assets/fire-crackle.mp3` | [Fire_Crackle_2.wav](https://freesound.org/people/KieranKeegan/sounds/422741/) by [KieranKeegan](https://freesound.org/people/KieranKeegan/), Freesound #422741 | 0–2.389 s | Gain +3.1 dB; 0.015 s fade at each edge |
| `audio-assets/fire-roar.mp3` | [Fire Crackle with Roaring Chimney](https://freesound.org/people/TheWoodlandNomad/sounds/363091/) by [TheWoodlandNomad](https://freesound.org/people/TheWoodlandNomad/), Freesound #363091 | 1–29 s | Gain -3 dB; 0.35 s fade at each edge |
| `audio-assets/charcoal.mp3` | [Fire crackling](https://freesound.org/people/cyberthilop/sounds/558983/) by [cyberthilop](https://freesound.org/people/cyberthilop/), Freesound #558983 | 0.15–9.15 s | Gain -2.6 dB; 0.08 s fade at each edge |
| `audio-assets/rain.mp3` | [Rain Sound and Rainforest.mp3](https://freesound.org/people/INNORECORDS/sounds/457447/) by [INNORECORDS](https://freesound.org/people/INNORECORDS/), Freesound #457447 | 8–40 s | Gain -2 dB; 0.4 s fade at each edge |
| `audio-assets/crickets.mp3` | [Crickets At Night - Clean sound](https://freesound.org/people/Defelozedd94/sounds/522298/) by [Defelozedd94](https://freesound.org/people/Defelozedd94/), Freesound #522298 | 8–28 s | Mono 44.1 kHz, 96 kbps; +6 dB; 0.6 s / 0.8 s edge fades. Used only after confirmed extinction |

The first four excerpts were re-encoded with FFmpeg to MP3 at 128 kbps and 44.1 kHz, with source channel count preserved and metadata removed. Gain was calculated from the excerpt peak toward −3 dBFS before MP3 encoding. MP3 container durations include codec padding. Edge fades and overlapping playback windows reduce clicks at transitions.

The older operator fire source is a log fire with chimney roar; the charcoal source is a wood/carbon cooking fire. They remain quieter supporting textures behind the generated forest bed. The rain source is a forest after rain with drops falling on ferns. At maximum Burning forest its sample is suppressed and synthetic broadband rain replaces it, to avoid ambient insect sounds within active burning. The separate cricket source enters only after confirmed extinction.

## Generated forest-fire bed

`audio-assets/burning-forest.mp3` uses genuine 60-second **Stable Audio 3.0 Small SFX** generations made through the [official Stability AI Space](https://huggingface.co/spaces/stabilityai/stable-audio-3). The model is [stable-audio-3-small-sfx](https://huggingface.co/stabilityai/stable-audio-3-small-sfx), published under the [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-small-sfx/blob/main/LICENSE.md). This is generated sound, not documentary audio of a real forest fire, and is not described as a Freesound or CC0 recording.

The prompts request intense, chaotic, unmetered roaring wildfire, irregular branches and trunks cracking, turbulent flames and ember gusts, excluding animals, crickets, music and voices. Separate close, middle and distant takes use seeds 2026103101–2026103103. Exact prompts, generation settings, raw master hashes, blend/export processing and validation are recorded in `burning-forest-source.json` and `stable-audio-generation.json`. Raw WAV masters are retained locally. Prompt adherence still requires a listening review; decode and headroom checks alone do not certify it.

`manifest.json` includes each public preview URL, license link, processing settings, final file size, duration, format, and SHA-256 digest.

## Retained Medium palette — catalog revision 5 history

Revision 5 of the catalog at `audio-assets/v3/manifest.json` contained 14 genuine
[Stable Audio 3 Medium](https://huggingface.co/stabilityai/stable-audio-3-medium)
assets: the three existing fire directions, new fine burning branches and
leaves for the phone, and ten endpoints for haze, ash, rain, moisture and
rhythmic cricket calls. The public directory stays `v3/`; the catalog revision
is 5. The previous `phone-crackle` source is archived, with all files and
provenance retained.
Earlier palette studies remain locally with their source records and are
excluded from the active catalog.

All new audio was generated on this Mac using the [pinned official MLX
runtime](https://github.com/Stability-AI/stable-audio-3/tree/5f5e6ac21ae9ff78a6e8847eb7a1dcbe969ffb84/optimized/mlx)
and the [pinned official optimized weights](https://huggingface.co/stabilityai/stable-audio-3-optimized/tree/30cb2644da54bfa63275d1bc7f1fa67fc718680f).
The complete model files passed the recorded official SHA-256 checks before
inference. Thirteen new 45-second generations produced ten published endpoint
takes; one haze take and two fine-ash takes were superseded after signal
checks. Their unchanged float masters and generation records remain retained.
Two further independent 45-second generations requested dry burning small
branches and leaves. Their exact prompts, distinct seeds 2026110101 and
2026110102, model/device details and unchanged float hashes are recorded in
`v3/medium-branches-leaves-batch.json`. Take 2 is the active
`phone-branches-leaves`; take 1 remains an optional audition outside the
active catalog. Selection used signal measurements, with no claim of human
listening certification. No external field recording or synthesized
substitute was added to these Medium assets.

The two new ash browser files preserve the generated bandwidth and use
320 kbps MP3 encoding, with no low-pass filtering, layered copies or
compression. Haze removes low rumbling weight with a 180 Hz high-pass.
Rain and moisture use fast 3:1 compression to soften isolated drop attacks,
without changing speed or pitch. Cricket copies use an 1800 Hz high-pass;
the repeated calls and quiet gaps come from the actual model output, with
no imposed pulse rhythm, time quantization or synthesized insect calls.
Desktop copies also receive boundary fades and conservative peak normalization.
The existing three fire/ember records retain their individually documented
processing.

The active phone branch/leaf file is an 18-second mono excerpt selected
directly from raw generated seconds 8–26, encoded once at 44.1 kHz/96 kbps.
It and the 45-second stereo desktop copy use peak normalization and 5 ms
click guards at each edge, with no filtering, compression, layering or long
export fades. The phone runtime prepares circular playback overlap. The
cricket phone file remains unchanged: a 15-second mono excerpt of its
published source, 22.05 kHz/64 kbps, with 120/300 ms fades. These compact files
are explicit derivatives, not additional generations. Each source JSON
and the catalog's `mobile` metadata provide exact origin, processing, size
and hash. The ZIP includes the alternate branch/leaf MP3 and provenance in
`audition/`, separate from its 14 active catalog choices.

The model is supplied under the [Stable Audio Community License](https://huggingface.co/stabilityai/stable-audio-3-medium/blob/main/LICENSE.md).
These generated studies are separate from the CC0 Freesound recordings above
and are not documentary recordings of an actual wildfire. Exact prompts,
seeds, model revisions, unchanged float master hashes, browser hashes,
processing and decode/headroom measurements are recorded in `v3/*-source.json`.
`v3/README.md` explains reproduction; `v3/palette-validation.json` and
`v3/branches-leaves-validation.json` record spectral and amplitude-envelope
evidence. Signal measurements do not certify
perceptual prompt adherence or claim human listening review.

The official runtime and approximately 5.18 GB of verified weights remain in
the project's `.audio-model-cache/` for future revisions. No model request,
download or generation occurs during a performance.
