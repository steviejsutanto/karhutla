#!/usr/bin/env python3
"""Publish compact, independently generated wildlife phrases with provenance.

Raw model masters remain unchanged. These are synthetic creative
interpretations, not field recordings or evidence of animal emotion.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
BATCH = 'medium-wildlife-v25-batch.json'
RATE = 32000
SELECTIONS = {
    'orangutan-distant-v25': dict(start=0, duration=16, highpass=110, lowpass=1800,
                                 fade_in=.6, fade_out=1.6, target=-29, ceiling=-13, bitrate=80),
    'rainforest-bird-low-a-v25': dict(start=0, duration=2.8, highpass=220, lowpass=2600,
                                    generationId='rainforest-bird-low-a-v25-take2', batch='medium-wildlife-v25-retry-batch.json',
                                    fade_in=.08, fade_out=.4, target=-30, ceiling=-13, bitrate=64),
    'rainforest-bird-low-b-v25': dict(start=.8, duration=2.8, highpass=220, lowpass=2600,
                                    fade_in=.08, fade_out=.4, target=-30, ceiling=-13, bitrate=64),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def ffmpeg(*args):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)],
                          check=True, capture_output=True).stdout


def metrics(path):
    x = np.frombuffer(ffmpeg('-xerror', '-i', path, '-ar', RATE, '-ac', 1, '-f', 'f32le', '-'),
                      dtype='<f4').astype(np.float64)
    if len(x) == 0 or not np.all(np.isfinite(x)):
        raise ValueError(f'Empty or invalid decode: {path}')
    db = lambda value: float(20 * np.log10(max(float(value), 1e-12)))
    spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    frequencies = np.fft.rfftfreq(len(x), 1 / RATE)
    total = max(float(spectrum.sum()), 1e-30)
    return dict(completeDecode='passed', samplesPerChannel=len(x), nonFiniteSamples=0,
                durationSeconds=len(x) / RATE, peakDbfs=db(np.max(np.abs(x))),
                rmsDbfs=db(np.mean(x * x) ** .5), nearFullScaleSampleFraction=float(np.mean(np.abs(x) >= .999)),
                spectralEnergyAbove3kHz=float(spectrum[frequencies > 3000].sum() / total),
                scope='Full decoded signal checks. No human listening, species certification, or animal emotion claim.')


def main():
    batch = json.loads((ASSETS / BATCH).read_text())
    if batch['status'] != 'complete':
        raise ValueError('Complete local generation required before publication')
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    retained = [row for row in manifest['assets'] if row['id'] not in SELECTIONS]
    for row in retained:
        if digest(ROOT / row['file']) != row['sha256']:
            raise ValueError(f'Retained audio differs from manifest: {row["id"]}')
    rows = []
    for identifier, selection in SELECTIONS.items():
        generation_id = selection.get('generationId', identifier)
        batch_name = selection.get('batch', BATCH)
        generation_batch = json.loads((ASSETS / batch_name).read_text())
        if generation_batch['status'] != 'complete':
            raise ValueError(f'Incomplete selected generation batch: {batch_name}')
        generation = json.loads((ASSETS / f'{generation_id}-generation.json').read_text())
        raw = ASSETS / generation['master']['file']
        if not generation['generated'] or digest(raw) != generation['master']['sha256']:
            raise ValueError(f'Generated master differs from its provenance: {identifier}')
        if generation_batch['assets'][generation_id]['master']['sha256'] != generation['master']['sha256']:
            raise ValueError(f'Batch/master mismatch: {identifier}')
        duration = selection['duration']
        filters = (f'atrim=start={selection["start"]}:duration={duration},asetpts=PTS-STARTPTS,'
                   f'highpass=f={selection["highpass"]}:p=2,lowpass=f={selection["lowpass"]}:p=2,'
                   f'afade=t=in:st=0:d={selection["fade_in"]},'
                   f'afade=t=out:st={duration-selection["fade_out"]}:d={selection["fade_out"]}')
        processed = ASSETS / f'{identifier}-processed-master.wav'
        output = ASSETS / f'{identifier}.mp3'
        ffmpeg('-i', raw, '-af', filters, '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', processed)
        before = metrics(processed)
        gain_db = min(selection['target'] - before['rmsDbfs'], selection['ceiling'] - 1 - before['peakDbfs'])
        for _ in range(4):
            ffmpeg('-i', processed, '-af', f'volume={gain_db:.9f}dB', '-ar', RATE, '-ac', 1,
                   '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', f'{selection["bitrate"]}k', output)
            measured = metrics(output)
            if measured['peakDbfs'] <= selection['ceiling']:
                break
            gain_db -= measured['peakDbfs'] - selection['ceiling'] + .3
        else:
            raise ValueError(f'Encoded peak remains too high: {identifier}')
        if measured['samplesPerChannel'] != round(duration * RATE):
            raise ValueError(f'Decode duration differs: {identifier}')
        browser = dict(file=str(output.relative_to(ROOT)), bytes=output.stat().st_size,
                       sha256=digest(output), durationSeconds=duration, sampleRate=RATE, channels=1,
                       bitrateKbps=selection['bitrate'], validation=measured)
        processing = (f'Exact source excerpt {selection["start"]}–{selection["start"]+duration}s; '
                      f'mono {RATE}Hz, two-pole {selection["highpass"]}Hz high-pass and '
                      f'{selection["lowpass"]}Hz low-pass; {selection["fade_in"]}s onset and '
                      f'{selection["fade_out"]}s release fades. Fixed {gain_db:.6f}dB gain. '
                      f'MP3 {selection["bitrate"]}kbps encoded directly from float, decoded peak '
                      f'checked below {selection["ceiling"]}dBFS. No looping, time/pitch shift, '
                      'compression, substitute synthesis, layering, reverb or external recordings.')
        source = dict(id=identifier, title=generation['title'], kind=generation['kind'],
                      description=generation['role'], generated=True,
                      assetKind='processed-excerpt-of-genuine-model-output', rawModelOutput=False,
                      sourceGeneration=generation, generationBatchRecord=batch_name, generationId=generation_id,
                      rawGeneratedMaster=generation['master'], sourceMasterUnchangedCheck=True,
                      **{key: generation[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
                      processing=processing, selection=selection, fixedGainDb=gain_db,
                      browserAsset=browser, validation=measured,
                      listeningReview='No human listening review claimed. Original synthetic creative interpretation; '
                                      'not an authentic field recording, species verification, or claim of actual animal grief.',
                      completedAt=datetime.now(timezone.utc).isoformat())
        write_json(ASSETS / f'{identifier}-source.json', source)
        row = {key: source[key] for key in ('id', 'kind', 'title', 'description', 'generated', 'assetKind',
                                          'rawModelOutput', 'model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl', 'processing')}
        row.update(browser)
        row['provenanceFile'] = f'audio-assets/v3/{identifier}-source.json'
        row['generationBatchRecord'] = batch_name
        row['generationId'] = generation_id
        if generation['kind'] == 'wildlife-bird':
            row['mobile'] = browser
        rows.append(row)
    manifest['assets'] = retained + rows
    manifest['version'] = max(14, manifest['version'])
    manifest['wildlife'] = dict(orangutan='orangutan-distant-v25',
                               birds=['rainforest-bird-low-a-v25', 'rainforest-bird-low-b-v25'])
    write_json(manifest_path, manifest)
    validation = dict(status='complete', catalogRevision=manifest['version'],
                      syntheticInterpretation=True, activeAssetCount=len(manifest['assets']),
                      generationBatch=BATCH, unchangedRetainedAssets=len(retained),
                      alternateBatch='medium-wildlife-v25-retry-batch.json',
                      selectionNotes='Bird A uses independently generated take 2: dominant frequency about 369Hz. '
                                     'First A take was about 2.5kHz and is excluded; take 3 was diffuse and is excluded. '
                                     'This is a spectral/envelope selection, not a human listening review.',
                      assets={row['id']: {key: row[key] for key in ('file', 'durationSeconds', 'bytes', 'sha256', 'validation')}
                              for row in rows})
    write_json(ASSETS / 'wildlife-v25-validation.json', validation)
    print(json.dumps(validation, indent=2))


if __name__ == '__main__':
    main()
