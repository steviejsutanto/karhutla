#!/usr/bin/env python3
"""Finish verified Medium palette masters, without running model inference.

Unchanged float model masters remain the provenance root. Any optional tonal
or dynamic treatment is a separate float derivative and explicitly labelled.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
PACK = ROOT / 'scripts/stablegen-v4-palette-prompts.json'


def load_finisher():
    spec = importlib.util.spec_from_file_location('wildfire_palette_finisher', ROOT / 'scripts/stablegen-v3-textures.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def finish_one(preset, batch, finish):
    identifier = preset['id']
    generation_id = preset.get('generationId', identifier)
    proof = json.loads((ASSETS / f'{generation_id}-generation.json').read_text())
    raw = ASSETS / proof['master']['file']
    if proof.get('generated') is not True or proof.get('status') != 'generated' or proof['prompt'] != preset['prompt'] or proof['seed'] != preset['seed'] or finish.sha256(raw) != proof['master']['sha256']:
        raise ValueError(f'Exact genuine completed generation is required: {identifier}')
    batch_name = None
    for path in sorted(ASSETS.glob('medium*batch.json')):
        candidate = finish.read_active_json(path)
        if any(row.get('startedAt') == proof.get('startedAt') and row.get('master', {}).get('sha256') == proof['master']['sha256'] for row in candidate.get('assets', {}).values()):
            batch, batch_name = candidate, path.name
            break
    raw_metrics = finish.audio_metrics(raw)
    record = {**proof, 'id': identifier, 'verifiedWeights': batch['verifiedWeights'], 'device': batch['device'],
              'assetKind': 'generated-model-output', 'rawModelOutput': True,
              'kind': preset['kind'], 'endpoint': preset['endpoint'], 'endpointPosition': preset['endpointPosition']}
    if batch_name:
        record['generationBatchRecord'] = batch_name
    if generation_id != identifier:
        record.update({'generationId': generation_id, 'sourceGeneration': proof})
    filters, description = [], []
    # Air weight comes from its bass energy, so remove only that weight while
    # preserving fine airy detail. This is not applied to the clear ash takes.
    if preset['kind'] == 'haze':
        filters.append('highpass=f=180:p=2')
        description.append('180 Hz two-pole high-pass removes low rumbling weight while retaining airy detail.')
    # Model water can contain isolated high-crest drops. Moderate fast
    # compression softens their onset without changing playback rate or pitch.
    if preset['kind'] in ['moisture', 'rain']:
        rms = 10 ** (raw_metrics['rmsDbfs'] / 20)
        threshold = max(.000976, min(.2, rms * 1.8))
        filters.append(f'acompressor=threshold={threshold:.9f}:ratio=3:attack=0.5:release=180:makeup=1:knee=2.828:detection=peak:link=maximum')
        description.append(f'Fast gentle 3:1 compression at {threshold:.9f} amplitude threshold, 0.5 ms attack and 180 ms release softens isolated water onsets. No pitch or speed changes.')
    if preset['kind'] == 'crickets':
        filters.append('highpass=f=1800:p=2')
        description.append('1800 Hz two-pole high-pass removes low background rumble under the generated cricket calls; no imposed rhythm or added insect sound.')
    master = raw
    if filters:
        master = ASSETS / f'{identifier}-processed-master.wav'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(raw), '-af', ','.join(filters), '-c:a', 'pcm_f32le', str(master)], check=True)
        record.update({'assetKind': 'processed-derivative-of-genuine-model-output', 'rawModelOutput': False,
                       'derivedFromGenuineModelOutput': True, 'sourceGeneration': proof,
                       'rawGeneratedMaster': proof['master'], 'rawMasterValidation': raw_metrics,
                       'derivation': {'source': raw.name, 'filters': ','.join(filters), 'description': ' '.join(description)}})
    finish.finish_asset(master, preset, proof['durationSeconds'], record)
    if filters:
        record['processing'] = ' '.join(description) + ' Unchanged raw float model master retained. Browser derivative: 250 ms fade-in, 500 ms fade-out, peak normalization before stereo 44.1 kHz 160 kbps MP3 encoding. Encoded peak <= -3 dBFS verified. No reverb, delay, external recording, music, or synthesized substitute added.'
    else:
        record['processing'] += ' Natural full-bandwidth ash detail retained; no low-pass, layering, compression or lo-fi treatment.'
    record['sourceMasterUnchangedCheck'] = finish.sha256(raw) == proof['master']['sha256']
    finish.write_json(ASSETS / f'{identifier}-source.json', record)
    return record


def mobile_copy(identifier, finish):
    provenance = ASSETS / f'{identifier}-source.json'
    source = json.loads(provenance.read_text())
    original = ASSETS / source['browserAsset']['file']
    mobile = ASSETS / f'{identifier}-mobile.mp3'
    gain = 0.0
    for _ in range(3):
        filters = f'afade=t=in:st=0:d=0.12,afade=t=out:st=14.7:d=0.3,volume={gain:.9f}dB'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', '8', '-i', str(original), '-t', '15', '-af', filters,
                        '-ar', '22050', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', str(mobile)], check=True)
        measured = finish.audio_metrics(mobile)
        if measured['peakDbfs'] <= -3:
            break
        gain -= measured['peakDbfs'] + 3.25
    else:
        raise ValueError('Mobile encoding exceeds peak ceiling')
    source['mobile'] = {'file': str(mobile.relative_to(ROOT)), 'bytes': mobile.stat().st_size, 'sha256': finish.sha256(mobile),
                        'durationSeconds': 15, 'channels': 1, 'sampleRate': 22050, 'bitrateKbps': 64,
                        'assetKind': 'mobile-derivative-of-published-generated-asset',
                        'sourceFile': str(original.relative_to(ROOT)), 'sourceSha256': finish.sha256(original),
                        'processing': f'Select seconds 8–23 of published browser asset, mono downmix, 22.05 kHz resample, 120 ms/300 ms boundary fades, {gain:.9f} dB additional gain, 64 kbps MP3. No additional model generation.',
                        'validation': measured}
    finish.write_json(provenance, source)
    return source['mobile']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--mobile', action='store_true')
    args = parser.parse_args()
    finish = load_finisher()
    batch = finish.read_active_json(ASSETS / 'medium-palette-batch.json')
    presets = json.loads(PACK.read_text())['assets']
    document = {'model': batch['model'], 'batchRecord': 'medium-palette-batch.json', 'assets': {}}
    path = ASSETS / 'palette-generation.json'
    if path.exists():
        document = json.loads(path.read_text())
    for preset in presets:
        if args.only and preset['id'] not in args.only:
            continue
        document['assets'][preset['id']] = finish_one(preset, batch, finish)
        finish.write_json(path, document)
    if args.mobile:
        for identifier in ['phone-crackle', 'crickets-pulse']:
            result = mobile_copy(identifier, finish)
            print(f"Mobile {identifier}: {result['bytes']} bytes", flush=True)
            if identifier in document['assets']:
                document['assets'][identifier] = json.loads((ASSETS / f'{identifier}-source.json').read_text())
    document.pop('batchRecord', None)
    document['batchRecords'] = sorted({row['generationBatchRecord'] for row in document['assets'].values() if row.get('generationBatchRecord')})
    finish.write_json(path, document)


if __name__ == '__main__':
    main()
