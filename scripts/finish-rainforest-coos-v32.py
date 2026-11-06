#!/usr/bin/env python3
"""Bake two compact, higher-register phone coos from retained bird masters.

These are derivatives of independently generated synthetic bird material,
not new generations, authentic field recordings, or mammal-source audio.
No pitch processing or model inference is required during phone playback.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
RATE = 32000
SEMITONES = 9
BAKED_RATE = round(RATE * 2 ** (SEMITONES / 12))
RATE_RATIO = BAKED_RATE / RATE
SELECTIONS = {
    'rainforest-coo-a-v32': dict(sourceAsset='rainforest-bird-low-a-v25',
        title='Rainforest soft flute coo A', start=0, sourceDuration=2.15),
    'rainforest-coo-b-v32': dict(sourceAsset='rainforest-bird-low-b-v25',
        title='Rainforest soft flute coo B', start=.8, sourceDuration=2.15),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def ffmpeg(*args):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)],
                          check=True, capture_output=True).stdout


def metrics(path):
    x = np.frombuffer(ffmpeg('-xerror', '-i', path, '-ar', RATE, '-ac', 1, '-f', 'f32le', '-'),
                      dtype='<f4').astype(np.float64)
    if not len(x) or not np.all(np.isfinite(x)):
        raise ValueError(f'Invalid decode: {path}')
    spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    frequencies = np.fft.rfftfreq(len(x), 1 / RATE)
    total = max(float(spectrum.sum()), 1e-30)
    cumulative = np.cumsum(spectrum) / total
    block = int(.01 * RATE)
    envelope = np.sqrt(np.mean(x[:len(x) // block * block].reshape(-1, block) ** 2, axis=1))
    active_indices = np.flatnonzero(envelope >= max(float(envelope.max()) * .1, 1e-7))
    span = None if not len(active_indices) else [round(float(active_indices[0]) * .01, 3),
                                               round(float(active_indices[-1] + 1) * .01, 3)]
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    return dict(completeDecode='passed', durationSeconds=len(x) / RATE,
                samplesPerChannel=len(x), nonFiniteSamples=0,
                rmsDbfs=db(np.sqrt(np.mean(x * x))), peakDbfs=db(np.max(np.abs(x))),
                dominantFrequencyHz=float(frequencies[np.argmax(spectrum)]),
                medianEnergyFrequencyHz=float(frequencies[np.searchsorted(cumulative, .5)]),
                energy95PercentFrequencyHz=float(frequencies[np.searchsorted(cumulative, .95)]),
                energyBelow450Hz=float(spectrum[frequencies < 450].sum() / total),
                energyAbove3kHz=float(spectrum[frequencies > 3000].sum() / total),
                activeSpanSeconds=span, activeThreshold='10% of maximum 10ms RMS envelope',
                scope='Complete decoded signal checks only; no human listening or species certification.')


def main():
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    retained = [row for row in manifest['assets'] if row['id'] not in SELECTIONS]
    retained_digests = {}
    for row in retained:
        if digest(ROOT / row['file']) != row['sha256']:
            raise ValueError(f'Retained file hash changed: {row["id"]}')
        retained_digests[row['id']] = row['sha256']
        if row.get('mobile') and digest(ROOT / row['mobile']['file']) != row['mobile']['sha256']:
            raise ValueError(f'Retained mobile hash changed: {row["id"]}')
    main_id = manifest['wildlife']['orangutan']
    main_row = next(row for row in retained if row['id'] == main_id)
    main_metrics = metrics(ROOT / main_row['file'])
    source_comparison = {}
    rows = []
    for identifier, selection in SELECTIONS.items():
        old_row = next(row for row in retained if row['id'] == selection['sourceAsset'])
        old_source = json.loads((ROOT / old_row['provenanceFile']).read_text())
        generation = old_source['sourceGeneration']
        master = ASSETS / generation['master']['file']
        if digest(master) != generation['master']['sha256']:
            raise ValueError(f'Original generated master changed: {identifier}')
        source_comparison[selection['sourceAsset']] = metrics(ROOT / old_row['file'])
        shifted_duration = selection['sourceDuration'] / RATE_RATIO
        filters = (f'atrim=start={selection["start"]}:duration={selection["sourceDuration"]},'
                   f'asetpts=PTS-STARTPTS,aresample={RATE},asetrate={BAKED_RATE},aresample={RATE},'
                   f'highpass=f=450:p=2,lowpass=f=3000:p=2,'
                   f'afade=t=in:d=0.045,afade=t=out:st={shifted_duration-.16:.9f}:d=0.16,'
                   'adelay=60:all=1,apad=pad_dur=0.12')
        processed = ASSETS / f'{identifier}-processed-master.wav'
        output = ASSETS / f'{identifier}.mp3'
        ffmpeg('-i', master, '-af', filters, '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', processed)
        before = metrics(processed)
        gain_db = min(-30 - before['rmsDbfs'], -20 - before['peakDbfs'])
        ffmpeg('-i', processed, '-af', f'volume={gain_db:.9f}dB', '-ar', RATE, '-ac', 1,
               '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '64k', output)
        measured = metrics(output)
        if not 1 <= measured['durationSeconds'] <= 2 or measured['peakDbfs'] > -19:
            raise ValueError(f'Compact coo duration/peak criteria failed: {identifier}')
        if measured['dominantFrequencyHz'] <= main_metrics['energy95PercentFrequencyHz'] * 1.3:
            raise ValueError(f'Coo did not move sufficiently above Main register: {identifier}')
        browser = dict(file=str(output.relative_to(ROOT)), durationSeconds=measured['durationSeconds'],
                       bytes=output.stat().st_size, sha256=digest(output), sampleRate=RATE,
                       channels=1, bitrateKbps=64, validation=measured)
        processing = (f'Derived from the unchanged original generated bird master, interval '
                      f'{selection["start"]}–{selection["start"]+selection["sourceDuration"]} s. '
                      f'Offline rate lift {RATE_RATIO:.9f}×, approximately +9 semitones; '
                      '450 Hz high-pass / 3000 Hz low-pass, 45 ms onset / 160 ms release fades; '
                      f'60 ms leading / 120 ms trailing quiet, fixed {gain_db:.6f} dB gain. '
                      'Mono 32 kHz / 64 kbps MP3. No new generation, mammal source, external '
                      'sample, loop, layering, compression, reverb or playback-time pitch DSP.')
        source = dict(id=identifier, title=selection['title'], kind='wildlife-bird',
                      generated=True, newGeneration=False,
                      assetKind='offline-rate-lifted-derivative-of-original-bird-model-output',
                      rawModelOutput=False, sourceGeneration=generation,
                      generationBatchRecord=old_source['generationBatchRecord'],
                      generationId=old_source['generationId'],
                      sourceAsset=selection['sourceAsset'],
                      sourceAssetSha256=old_row['sha256'],
                      sourceProvenanceFile=old_row['provenanceFile'],
                      rawGeneratedMaster=generation['master'], sourceMasterUnchangedCheck=True,
                      selection=selection, bakedRateRatio=RATE_RATIO,
                      intendedPitchLiftSemitones=SEMITONES, processing=processing,
                      fixedGainDb=gain_db, browserAsset=browser, validation=measured,
                      completedAt=datetime.now(timezone.utc).isoformat(),
                      listeningReview='Synthetic creative interpretation, not a field recording or '
                                      'species-certified call. Spectral separation from Main is measured; '
                                      'perceptual distinction still requires listening.')
        for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl'):
            source[key] = generation[key]
        write(ASSETS / f'{identifier}-source.json', source)
        row = {key: source[key] for key in ('id', 'kind', 'title', 'generated', 'assetKind',
                                           'rawModelOutput', 'model', 'modelUrl', 'sourceUrl',
                                           'license', 'licenseUrl', 'processing')}
        row.update(browser)
        row.update(description='A compact soft flute-like coo baked above Main’s low voice register.',
                   mobile=browser, provenanceFile=f'audio-assets/v3/{identifier}-source.json',
                   generationBatchRecord=old_source['generationBatchRecord'],
                   generationId=old_source['generationId'])
        rows.append(row)
    manifest['assets'] = retained + rows
    manifest['version'] = max(16, manifest['version'])
    manifest['wildlife']['birds'] = list(SELECTIONS) + ['rainforest-chirp-c-v31']
    write(manifest_path, manifest)
    validation = dict(status='complete', catalogRevision=manifest['version'],
                      activeAssetCount=len(manifest['assets']), syntheticInterpretation=True,
                      newGeneration=False, unchangedRetainedAssets=len(retained),
                      retainedAssetSha256=retained_digests,
                      mainOrangutan=dict(id=main_id, sha256=main_row['sha256'], validation=main_metrics),
                      originalBirdComparison=source_comparison,
                      bakedRateRatio=RATE_RATIO, intendedPitchLiftSemitones=SEMITONES,
                      selectionNotes='Two independently generated bird sources, not Main orangutan audio. '
                                     'Offline rate lift shortens their complete soft coo phrases and '
                                     'separates their register from Main. No new synthesis or phone DSP.',
                      assets={row['id']: {key: row[key] for key in ('file', 'durationSeconds', 'bytes',
                                                                  'sha256', 'validation')} for row in rows})
    write(ASSETS / 'rainforest-coos-v32-validation.json', validation)
    print(json.dumps({key: validation[key] for key in ('status', 'catalogRevision', 'activeAssetCount',
                                                     'unchangedRetainedAssets', 'mainOrangutan', 'assets')}, indent=2))


if __name__ == '__main__':
    main()
