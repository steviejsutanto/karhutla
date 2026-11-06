#!/usr/bin/env python3
"""Publish one isolated chirp per compact phone asset from original model masters.

Keeps the low coos and every original master unchanged. These are synthetic
creative interpretations, not field recordings or species-certified calls.
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
SELECTIONS = {
    'rainforest-chirp-a-v31': dict(generation='rainforest-chirp-a-v31',
        batch='medium-rainforest-chirps-v31-batch.json', start=.68, end=.90,
        title='Rainforest rising chirp'),
    'rainforest-chirp-b-v31': dict(generation='rainforest-chirp-b-v31-take2',
        batch='medium-rainforest-chirps-v31-retry-batch.json', start=3.055, end=3.285,
        title='Rainforest flute chirp'),
    'rainforest-chirp-c-v31': dict(generation='rainforest-chirp-c-v31-take2',
        batch='medium-rainforest-chirps-v31-retry-batch.json', start=.055, end=.345,
        title='Rainforest small chirp'),
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
    window = int(.01 * RATE)
    envelope = np.sqrt(np.mean(x[:len(x) // window * window].reshape(-1, window) ** 2, axis=1))
    active = envelope >= max(float(envelope.max()) * .12, 1e-7)
    groups = []
    for index, value in enumerate(active):
        if value:
            if groups and index - groups[-1][1] <= 5:
                groups[-1][1] = index
            else:
                groups.append([index, index])
    groups = [group for group in groups if group[1] - group[0] >= 1]
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    return dict(completeDecode='passed', durationSeconds=len(x) / RATE,
                samplesPerChannel=len(x), nonFiniteSamples=0,
                rmsDbfs=db(np.sqrt(np.mean(x * x))), peakDbfs=db(np.max(np.abs(x))),
                dominantFrequencyHz=float(frequencies[np.argmax(spectrum)]),
                energyBelow650Hz=float(spectrum[frequencies < 650].sum() / total),
                energyAbove4kHz=float(spectrum[frequencies > 4000].sum() / total),
                activeBurstCount=len(groups), activeBurstSeconds=[round((b - a + 1) * .01, 3) for a, b in groups],
                scope='Complete signal and envelope checks only; no human listening or species-certification claim.')


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
    rows = []
    for identifier, selection in SELECTIONS.items():
        generation_id = selection['generation']
        batch = json.loads((ASSETS / selection['batch']).read_text())
        generation = json.loads((ASSETS / f'{generation_id}-generation.json').read_text())
        if batch['status'] != 'complete' or not generation['generated']:
            raise ValueError('Generation must complete before publishing')
        master = ASSETS / generation['master']['file']
        if digest(master) != generation['master']['sha256']:
            raise ValueError(f'Master hash changed: {identifier}')
        duration = selection['end'] - selection['start']
        # Isolate exactly one source burst; short digital quiet edges keep the
        # browser one-shot distinct from a repeating phrase or low coo bed.
        filters = (f'atrim=start={selection["start"]}:end={selection["end"]},asetpts=PTS-STARTPTS,'
                   f'highpass=f=650:p=2,lowpass=f=3800:p=2,'
                   f'afade=t=in:d=0.012,afade=t=out:st={duration-.025:.6f}:d=0.025,'
                   'adelay=160:all=1,apad=pad_dur=0.22')
        processed = ASSETS / f'{identifier}-processed-master.wav'
        output = ASSETS / f'{identifier}.mp3'
        ffmpeg('-i', master, '-af', filters, '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', processed)
        before = metrics(processed)
        gain_db = min(-26 - before['rmsDbfs'], -14 - before['peakDbfs'])
        ffmpeg('-i', processed, '-af', f'volume={gain_db:.9f}dB', '-ar', RATE, '-ac', 1,
               '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '64k', output)
        measured = metrics(output)
        if measured['activeBurstCount'] != 1 or measured['peakDbfs'] > -13 or not 900 < measured['dominantFrequencyHz'] < 3500:
            raise ValueError(f'Published clip does not meet the isolated chirp signal criteria: {identifier}: {measured}')
        browser = dict(file=str(output.relative_to(ROOT)), durationSeconds=measured['durationSeconds'],
                       bytes=output.stat().st_size, sha256=digest(output), sampleRate=RATE,
                       channels=1, bitrateKbps=64, validation=measured)
        processing = (f'One source burst from {selection["start"]}–{selection["end"]}s, '
                      '650Hz high-pass/3800Hz low-pass, 12ms/25ms edge fades; '
                      f'160ms leading and220ms trailing quiet; fixed{gain_db:.6f}dBgain; '
                      'mono32kHz64kbpsMP3. No loop, pitch/time change, compression, reverb, '
                      'layering, mammal-source substitution or external recording.')
        source = dict(id=identifier, title=selection['title'], kind='wildlife-bird',
                      generated=True, assetKind='isolated-excerpt-of-original-model-output', rawModelOutput=False,
                      sourceGeneration=generation, generationBatchRecord=selection['batch'], generationId=generation_id,
                      rawGeneratedMaster=generation['master'], sourceMasterUnchangedCheck=True,
                      selection=selection, processing=processing, browserAsset=browser,
                      validation=measured, completedAt=datetime.now(timezone.utc).isoformat(),
                      listeningReview='Synthetic creative interpretation; not an authentic field recording or species-certified bird. Technical envelope/spectral checks do not replace listening.')
        for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl'):
            source[key] = generation[key]
        write(ASSETS / f'{identifier}-source.json', source)
        row = {key: source[key] for key in ('id', 'kind', 'title', 'generated', 'assetKind', 'rawModelOutput',
                                           'model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl', 'processing')}
        row.update(browser)
        row.update(description='One brief clear middle-register rainforest bird chirp, replacing the archived low coos.',
                   mobile=browser, provenanceFile=f'audio-assets/v3/{identifier}-source.json',
                   generationBatchRecord=selection['batch'], generationId=generation_id)
        rows.append(row)
    manifest['assets'] = retained + rows
    manifest['version'] = max(15, manifest['version'])
    manifest['wildlife']['birds'] = list(SELECTIONS)
    write(manifest_path, manifest)
    validation = dict(status='complete', catalogRevision=manifest['version'], activeAssetCount=len(manifest['assets']),
                      syntheticInterpretation=True, unchangedRetainedAssets=len(retained),
                      retainedAssetSha256=retained_digests,
                      excludedTakes=['rainforest-chirp-b-v31', 'rainforest-chirp-c-v31'],
                      selectionNotes='Initial B and C masters had dominant low frequencies around287/722Hz and are excluded. The published files use one short clear2–3kHz burst each; no raw multi-call train is played.',
                      assets={row['id']: {key: row[key] for key in ('file', 'durationSeconds', 'bytes', 'sha256', 'validation')} for row in rows})
    write(ASSETS / 'rainforest-chirps-v31-validation.json', validation)
    print(json.dumps({key: validation[key] for key in ('status', 'catalogRevision', 'activeAssetCount', 'unchangedRetainedAssets', 'assets')}, indent=2))


if __name__ == '__main__':
    main()
