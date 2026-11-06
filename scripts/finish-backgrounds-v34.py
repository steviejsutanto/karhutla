#!/usr/bin/env python3
"""Finish new rain/air masters and centrally integrate the revision-17 catalog.

Only fixed filtering/gain and a documented circular source overlap are used.
Existing encoded files and model masters remain unchanged. Signal checks
do not establish the semantic identity or perceived character of a source.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
RATE = 44100
PREVIEWS = ROOT / 'output/audio-preview'
BATCH = 'medium-backgrounds-v34-retry-batch.json'
CRICKET_INTEGRATION = 'cricket-steady-phone-v34-integration.json'
CONFIG = {
    'rain-canopy-heavy-v34': dict(generation='rain-canopy-heavy-v34-take2',
        kind='rain', title='Heavy rainforest canopy wash',
        description='A new dense diffuse rainforest rain wash with soft distant foliage detail.',
        start=2, end=28, filters='highpass=f=100:p=2,lowpass=f=6000:p=2',
        target=-28.5, ceiling=-6, bitrate=192),
    'haze-calm-air-v34': dict(generation='haze-calm-air-v34-take2',
        kind='haze', title='Calm suspended warm air',
        description='New very light diffuse air and distant fine foliage texture for arrival.',
        start=4, end=26, filters='highpass=f=450:p=2,lowpass=f=6000:p=2',
        target=-36, ceiling=-10, bitrate=160),
    'haze-calm-drift-v34': dict(generation='haze-calm-drift-v34-take2',
        kind='haze', title='Quiet floating air drift',
        description='Independent quiet natural air and foliage texture with low wind weight removed.',
        start=4, end=26, filters='highpass=f=450:p=2,lowpass=f=6000:p=2',
        target=-36, ceiling=-10, bitrate=160),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, document):
    path.write_text(json.dumps(document, indent=2) + '\n')


def run(*args):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)],
                          capture_output=True, check=True).stdout


def metrics(path, rate=RATE, channels=2):
    raw = run('-xerror', '-i', path, '-ar', rate, '-ac', channels, '-f', 'f32le', '-')
    x = np.frombuffer(raw, dtype='<f4').reshape(-1, channels).astype(np.float64)
    if not len(x) or not np.all(np.isfinite(x)):
        raise ValueError(f'Invalid full decode: {path}')
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    blocks = x[:len(x) // rate * rate].reshape(-1, rate, channels)
    spectrum = np.abs(np.fft.rfft(blocks * np.hanning(rate)[None, :, None], axis=1)) ** 2
    power = spectrum.sum(axis=(0, 2))
    frequencies = np.fft.rfftfreq(rate, 1 / rate)
    total = max(float(power.sum()), 1e-30)
    per_second = 20 * np.log10(np.maximum(np.sqrt(np.mean(blocks ** 2, axis=(1, 2))), 1e-12))
    spectral_flatness = float(np.exp(np.mean(np.log(np.maximum(power[frequencies > 80], 1e-30)))) /
                              max(float(np.mean(power[frequencies > 80])), 1e-30))
    return dict(completeDecode='passed', durationSeconds=len(x) / rate,
                samplesPerChannel=len(x), sampleRate=rate, channels=channels, nonFiniteSamples=0,
                peakDbfs=db(np.max(np.abs(x))), rmsDbfs=db(np.sqrt(np.mean(x ** 2))),
                oneSecondRmsDbfs=per_second.tolist(), oneSecondRmsRangeDb=float(np.ptp(per_second)),
                oneSecondRmsStandardDeviationDb=float(np.std(per_second)),
                dominantFrequencyHz=float(frequencies[np.argmax(power)]),
                maximumOneHzBinEnergyFraction=float(power.max() / total),
                spectralFlatnessAbove80Hz=spectral_flatness,
                spectralEnergyFractions={f'{lo}-{hi}Hz': float(power[(frequencies >= lo) & (frequencies < hi)].sum() / total)
                                         for lo, hi in [(0, 100), (100, 300), (300, 2000), (2000, 6000), (6000, rate/2)]},
                decodedBoundaryStepAmplitude=float(np.max(np.abs(x[0] - x[-1]))),
                scope='Complete decoded signal checks only; no human listening or semantic source certification.')


def circular_overlap(samples, rate, seconds):
    """Join the actual source tail to its head without synthesized filler."""
    count = round(rate * seconds)
    if len(samples) < count * 3:
        raise ValueError('Source too short for bounded circular overlap')
    head, tail = samples[:count], samples[-count:]
    cross = float(np.sum(head * tail))
    correlation = float(np.clip(cross / np.sqrt(float(np.sum(head**2) * np.sum(tail**2)) or 1), -.5, .95))
    angle = np.linspace(0, np.pi/2, count)
    left, right = np.cos(angle)[:, None], np.sin(angle)[:, None]
    norm = np.sqrt(1 + 2 * correlation * left * right)
    blend = (tail * left + head * right) / norm
    return np.concatenate([samples[count:-count], blend]), correlation


def encode(path, output, *, channels, rate, bitrate, target, ceiling):
    before = metrics(path, rate=rate, channels=channels)
    gain = min(target - before['rmsDbfs'], ceiling - 1 - before['peakDbfs'])
    for _ in range(4):
        run('-i', path, '-af', f'volume={gain:.9f}dB', '-ar', rate, '-ac', channels,
            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', output)
        measured = metrics(output, rate=rate, channels=channels)
        if measured['peakDbfs'] <= ceiling:
            break
        gain -= measured['peakDbfs'] - ceiling + .3
    else:
        raise ValueError(f'Encoded peak budget failed: {output}')
    if measured['samplesPerChannel'] != before['samplesPerChannel']:
        raise ValueError(f'Incomplete decode duration: {output}')
    return dict(file=str(output.relative_to(ROOT)), bytes=output.stat().st_size, sha256=digest(output),
                durationSeconds=measured['durationSeconds'], sampleRate=rate, channels=channels,
                bitrateKbps=bitrate, normalization=dict(targetRmsDbfs=target, peakCeilingDbfs=ceiling,
                appliedGainDb=gain), validation=measured)


def finish(identifier, config, batch):
    generation_id = config['generation']
    generation = json.loads((ASSETS / f'{generation_id}-generation.json').read_text())
    master = ASSETS / generation['master']['file']
    if not generation['generated'] or generation['master']['sha256'] != digest(master):
        raise ValueError(f'Unchanged genuine master required: {identifier}')
    if batch['assets'][generation_id]['master']['sha256'] != generation['master']['sha256']:
        raise ValueError(f'Batch/master mismatch: {identifier}')
    filtered = ASSETS / f'{identifier}-filtered-master.wav'
    run('-i', master, '-af', config['filters'], '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', filtered)
    samples, rate = sf.read(filtered, always_2d=True, dtype='float64')
    excerpt = samples[round(config['start']*rate):round(config['end']*rate)]
    loop, correlation = circular_overlap(excerpt, rate, 2)
    processed = ASSETS / f'{identifier}-processed-master.wav'
    sf.write(processed, loop, rate, subtype='FLOAT')
    browser = encode(processed, ASSETS / f'{identifier}.mp3', channels=2, rate=RATE,
                     bitrate=config['bitrate'], target=config['target'], ceiling=config['ceiling'])
    # A second source-domain overlap makes the compact mobile derivative
    # periodic on its own; it is not a transcode of the full MP3.
    mobile_excerpt = loop[2*rate:18*rate]
    mobile_loop, mobile_correlation = circular_overlap(mobile_excerpt, rate, 1)
    mobile_working = ASSETS / f'{identifier}-mobile-processed-master.wav'
    sf.write(mobile_working, mobile_loop.mean(axis=1), rate, subtype='FLOAT')
    mobile = encode(mobile_working, ASSETS / f'{identifier}-mobile.mp3', channels=1, rate=32000,
                    bitrate=64, target=config['target'], ceiling=config['ceiling'])
    if mobile['bytes'] > 250000 or browser['bytes'] > 1100000:
        raise ValueError(f'Browser asset budget failed: {identifier}')
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    preview = encode(master, PREVIEWS / f'{identifier}-source-preview.mp3', channels=2, rate=RATE,
                     bitrate=192, target=-24, ceiling=-6)
    processing = (f'New unchanged generated source {generation_id}, seconds {config["start"]}–{config["end"]}; '
                  f'fixed {config["filters"]} filtering and a 2 s equal-power circular tail/head overlap '
                  'with correlation correction. Full stereo 44.1 kHz MP3; mobile from processed float '
                  'seconds 2–18 with its own 1 s circular overlap, mono 32 kHz / 64 kbps. '
                  f'Fixed gain toward {config["target"]} dBFS RMS, encoded peaks checked below '
                  f'{config["ceiling"]} dBFS. No compressor, limiter, envelope riding, pitch/rate shift, '
                  'added thunder, external sample, synthesized filler, delay or reverb. '
                  'Original generation, filtered master and processed masters retained unchanged.')
    source = dict(id=identifier, kind=config['kind'], title=config['title'], description=config['description'],
                  generated=True, newGeneration=True, rawModelOutput=False,
                  assetKind='fixed-filtered-circular-derivative-of-new-model-output',
                  generationId=generation_id, generationBatchRecord=BATCH, sourceGeneration=generation,
                  verifiedWeights=batch['verifiedWeights'], device=batch['device'],
                  rawGeneratedMaster=generation['master'], sourceMasterUnchangedCheck=True,
                  processing=processing, sourceExcerpt=dict(startSeconds=config['start'], endSeconds=config['end']),
                  filters=config['filters'], circularOverlapSeconds=2, sourceTailHeadCorrelation=correlation,
                  mobileTailHeadCorrelation=mobile_correlation,
                  processedMaster=dict(file=processed.name, bytes=processed.stat().st_size, sha256=digest(processed)),
                  browserAsset=browser, mobile=mobile, sourcePreview=preview,
                  sourcePreviewProcessing='Unfiltered full original master, one fixed-gain MP3 encode only; louder audition level toward -24 dBFS RMS constrained to -6 dBFS peak.',
                  validation=browser['validation'], rawMasterValidation=metrics(master),
                  playbackBoundary=dict(loopConditioning='offline-circular-overlap-plus-existing-native-circular-buffer',
                                        offlineCrossfadeSeconds=2, mobileOfflineCrossfadeSeconds=1),
                  listeningReview='Signal/provenance checks only. Actual source character, absence of voices/music, '
                                  'soft forest rain identity and calmness require audition; no human listening claimed.',
                  completedAt=datetime.now(timezone.utc).isoformat())
    for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl'):
        source[key] = generation[key]
    write(ASSETS / f'{identifier}-source.json', source)
    row = {key: source[key] for key in ('id', 'kind', 'title', 'description', 'generated', 'assetKind',
                                       'rawModelOutput', 'model', 'modelUrl', 'sourceUrl', 'license',
                                       'licenseUrl', 'processing', 'generationId', 'generationBatchRecord', 'playbackBoundary')}
    row.update(browser)
    row.update(mobile=mobile, provenanceFile=f'audio-assets/v3/{identifier}-source.json')
    return row, source


def main():
    batch = json.loads((ASSETS / BATCH).read_text())
    if batch['status'] != 'complete':
        raise ValueError('Completed local retry batch required')
    cricket = json.loads((ASSETS / CRICKET_INTEGRATION).read_text())
    new_ids = set(CONFIG) | {row['id'] for row in cricket['assets']}
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    retained = [row for row in manifest['assets'] if row['id'] not in new_ids]
    retained_digests = {}
    for row in retained + cricket['assets']:
        for variant in [row, row.get('mobile')]:
            if not variant:
                continue
            path = ROOT / variant['file']
            if digest(path) != variant['sha256'] or path.stat().st_size != variant['bytes']:
                raise ValueError(f'Prior or supplied asset mismatch: {row["id"]}')
        if row in retained:
            retained_digests[row['id']] = row['sha256']
    rows, sources = [], {}
    for identifier, config in CONFIG.items():
        row, source = finish(identifier, config, batch)
        rows.append(row)
        sources[identifier] = source
    manifest['version'] = max(17, manifest['version'])
    manifest['assets'] = retained + rows + cricket['assets']
    manifest['morphs']['rain'] = ['rain-natural-light', 'rain-canopy-heavy-v34']
    manifest['morphs']['haze'] = ['haze-calm-air-v34', 'haze-calm-drift-v34']
    manifest['rainAlternatives'] = list(dict.fromkeys(manifest.get('rainAlternatives', []) + ['rain-canopy-heavy-v34']))
    prior_haze = manifest['residueVariations']['haze']
    manifest['residueVariations']['haze'] = [i for i in prior_haze if i not in ['haze-air-v23', 'haze-float-v23']][:4] + list(CONFIG)[1:]
    manifest['phone'].update(cricket['phone'])
    write(manifest_path, manifest)
    validation = dict(status='complete', catalogRevision=manifest['version'], activeAssetCount=len(manifest['assets']),
                      unchangedRetainedAssets=len(retained), retainedAssetSha256=retained_digests,
                      generationBatchRecord=BATCH, originalBatchRecord='medium-backgrounds-v34-batch.json',
                      excludedGenerationIds=['rain-canopy-heavy-v34', 'rain-canopy-heavy-v34-take3',
                                             'haze-calm-air-v34', 'haze-calm-drift-v34'],
                      selectionNotes='Rain take2 has a broad and substantially steadier body than the initial low-swell candidate. '
                                     'Natural breeze/foliage retry prompts replace the first narrow-band abstract haze takes. '
                                     'Fixed high-pass removes low wind weight. These are signal-based choices, not listening certification.',
                      previewPaths={identifier: source['sourcePreview']['file'] for identifier, source in sources.items()},
                      mappings=dict(morphs=manifest['morphs'], phone=manifest['phone'], wildlife=manifest['wildlife']),
                      cricketIntegrationFile=CRICKET_INTEGRATION,
                      cricketIntegrationSha256=digest(ASSETS / CRICKET_INTEGRATION),
                      cricketAssetRows=cricket['assets'], cricketValidation=cricket['validation'],
                      assets={row['id']: {key: row[key] for key in ('file', 'durationSeconds', 'bytes', 'sha256',
                                                                  'validation', 'mobile')} for row in rows})
    write(ASSETS / 'backgrounds-v34-validation.json', validation)
    print(json.dumps({key: validation[key] for key in ('status', 'catalogRevision', 'activeAssetCount',
                                                     'unchangedRetainedAssets', 'previewPaths', 'assets')}, indent=2))


if __name__ == '__main__':
    main()
