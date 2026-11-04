#!/usr/bin/env python3
"""Publish verified genuine v20 generations and their documented derivatives.

No model inference, substitute synthesis, repeated-copy layering, pitch shift,
or speed change occurs here. Every unchanged official float master is checked
against both its completed batch and individual generation record before use.
"""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
PACK = ROOT / 'scripts/stablegen-v20-residue-prompts.json'
BATCHES = ['medium-residue-v20-batch.json', 'medium-wood-v20-retry-batch.json']
PHONE_ID = 'phone-branches-dry-v20'
PHONE_GENERATION = 'phone-branches-dry-v20'
NEW_RESIDUES = {
    'ash': ['ash-flutter-v20', 'ash-settle-v20'],
    'moisture': ['moisture-moss-v20', 'moisture-earth-v20'],
    'haze': ['haze-grass-v20', 'haze-leaves-v20'],
}
VARIATIONS = {
    'ash': ['ash-fine', 'ash-scatter', *NEW_RESIDUES['ash']],
    'moisture': ['moisture-seep', 'moisture-trickle', *NEW_RESIDUES['moisture']],
    'haze': ['haze-light', 'haze-drift', *NEW_RESIDUES['haze']],
}
RATE = 44100


def now():
    return datetime.now(timezone.utc).isoformat()


def load_helpers():
    path = ROOT / 'scripts/stablegen-v18-phone-finish.py'
    spec = importlib.util.spec_from_file_location('wildfire_v20_finish', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper, helper.load_tools()


def run(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)], check=True)


def proof(identifier, batches, tools):
    row = json.loads((ASSETS / f'{identifier}-generation.json').read_text())
    raw = ASSETS / row['master']['file']
    matches = [(name, batch) for name, batch in batches.items()
               if batch['assets'].get(identifier, {}).get('master', {}).get('sha256') == row['master']['sha256']]
    if (row.get('generated') is not True or row.get('status') != 'generated'
            or len(matches) != 1 or tools.sha256(raw) != row['master']['sha256']):
        raise ValueError(f'Completed genuine generation and matching unchanged master required: {identifier}')
    name, batch = matches[0]
    return row, raw, name, batch


def filters_for(kind, metrics):
    rms = 10 ** (metrics['rmsDbfs'] / 20)
    if kind == 'phone-crackle':
        return ('highpass=f=220:p=2,lowpass=f=6500:p=2,'
                'equalizer=f=1050:t=o:w=1.7:g=18,'
                'acompressor=threshold=0.008:ratio=4:attack=0.12:release=70:knee=2.8:makeup=1'), (
                    '220 Hz two-pole high-pass removes low weight; 6500 Hz two-pole low-pass and '
                    'a broad +18 dB 1050 Hz/1.7-octave equalizer support clear middle-frequency woody detail; '
                    'soft compressor threshold 0.008/ratio 4/attack 0.12 ms/release 70 ms/knee 2.8/makeup 1 '
                    'restrains isolated snaps.')
    if kind == 'ash':
        threshold = max(.001, min(.1, rms * 2.5))
        return (f'acompressor=threshold={threshold:.9f}:ratio=2:attack=0.15:release=90:knee=2.8:makeup=1'), (
                    f'Full generated ash bandwidth retained with no frequency filtering. Soft 2:1 compression '
                    f'at {threshold:.9f} amplitude threshold, 0.15 ms attack and 90 ms release restrains '
                    'isolated flake spikes; no layered copies or lo-fi treatment.')
    if kind == 'moisture':
        threshold = max(.001, min(.2, rms * 1.8))
        return (f'acompressor=threshold={threshold:.9f}:ratio=3:attack=0.5:release=180:knee=2.828:makeup=1'), (
                    f'Fast gentle 3:1 compression at {threshold:.9f} amplitude threshold, '
                    '0.5 ms attack and 180 ms release softens isolated water onsets; full bandwidth retained.')
    if kind == 'haze':
        threshold = max(.001, min(.1, rms * 1.8))
        return (f'highpass=f=180:p=2,acompressor=threshold={threshold:.9f}:ratio=3:attack=0.5:release=250:knee=2.828:makeup=1'), (
                    '180 Hz two-pole high-pass removes low rumbling weight while preserving fine airy detail. '
                    f'Gentle 3:1 compression at {threshold:.9f} amplitude threshold, 0.5 ms attack and '
                    '250 ms release restrains isolated gust spikes before fixed level matching.')
    raise ValueError(kind)


def finish(identifier, generation_id, kind, title, description, batches, helper, tools):
    generation, raw, batch_name, batch = proof(generation_id, batches, tools)
    duration = generation['durationSeconds']
    master_metrics = tools.audio_metrics(raw)
    filters, treatment = filters_for(kind, master_metrics)
    processed = ASSETS / f'{identifier}-processed-master.wav'
    run('-i', raw, '-af', filters, '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', processed)
    working = ASSETS / f'{identifier}.working.wav'
    mobile_working = ASSETS / f'{identifier}-mobile.working.wav'
    target = {'phone-crackle': -29.5, 'ash': -35.5, 'moisture': -27.2, 'haze': -29}[kind]
    ceiling = -7 if kind == 'phone-crackle' else -4
    try:
        run('-i', processed, '-af', f'afade=t=in:st=0:d=0.005,afade=t=out:st={duration-.005}:d=0.005',
            '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', working)
        browser = helper.encode(working, ASSETS / f'{identifier}.mp3', duration, tools,
                                channels=2, bitrate=320 if kind == 'ash' else 160,
                                target_rms=target, peak_ceiling=ceiling)
        run('-ss', 6, '-i', processed, '-t', 18,
            '-af', 'afade=t=in:st=0:d=0.005,afade=t=out:st=17.995:d=0.005',
            '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', mobile_working)
        mobile = helper.encode(mobile_working, ASSETS / f'{identifier}-mobile.mp3', 18, tools,
                               channels=1, bitrate=96, target_rms=target, peak_ceiling=ceiling)
    finally:
        working.unlink(missing_ok=True)
        mobile_working.unlink(missing_ok=True)
    mobile.update({
        'assetKind': 'mobile-derivative-of-genuine-model-output',
        'sourceGeneration': generation_id,
        'sourceExcerptStartSeconds': 6,
        'sourceExcerptEndSeconds': 24,
        'sourceMasterSha256': generation['master']['sha256'],
        'processing': 'Direct seconds 6–24 of the processed float derivative, mono downmix and 5 ms boundary guards; '
                      'fixed normalization and a single 44.1 kHz/96 kbps MP3 encoding. No MP3-to-MP3 transcode.',
    })
    source = {
        'id': identifier, 'kind': kind, 'title': title, 'description': description,
        **{key: generation[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
        'generated': True, 'assetKind': 'processed-derivative-of-genuine-model-output', 'rawModelOutput': False,
        'generationId': generation_id, 'sourceGeneration': generation,
        'generationBatchRecord': batch_name, 'verifiedWeights': batch['verifiedWeights'], 'device': batch['device'],
        'rawGeneratedMaster': generation['master'], 'rawMasterValidation': master_metrics,
        'processedMaster': {'file': processed.name, 'bytes': processed.stat().st_size, 'sha256': tools.sha256(processed)},
        'derivation': {'source': raw.name, 'filters': filters, 'description': treatment},
        'processing': treatment + f' Unchanged genuine float model master retained. Main derivative: {duration} seconds, '
                      f'5 ms boundary guards, fixed gain toward {target} dBFS RMS constrained by {ceiling} dBFS encoded peak ceiling, '
                      f'stereo 44.1 kHz/{browser["bitrateKbps"]} kbps MP3. Mobile: direct 6–24 s float excerpt, '
                      'mono 44.1 kHz/96 kbps, 5 ms guards. No repeated-copy layering, reverb, delay, '
                      'external sound, synthesized substitute, pitch or speed change.',
        'browserAsset': browser, 'mobile': mobile, 'validation': browser['validation'],
        'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
        'sourceMasterUnchangedCheck': tools.sha256(raw) == generation['master']['sha256'],
        'listeningReview': 'Signal measurements only. No human listening certification; perceptual prompt adherence remains unverified.',
        'completedAt': now(),
    }
    helper.save(ASSETS / f'{identifier}-source.json', source)
    return helper.catalog_row(source, browser, mobile), source


def waveform_correlations(manifest, tools):
    # Compare actual decoded source waveforms at equal positions; this is a
    # copied-signal diagnostic, not proof of perceptual diversity or quality.
    assets = {row['id']: row for row in manifest['assets']}
    results = {}
    for kind, identifiers in VARIATIONS.items():
        waves = {}
        for identifier in identifiers:
            filename = ROOT / assets[identifier]['file']
            decoded = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(filename),
                                              '-t', '18', '-ar', '11025', '-ac', '1', '-f', 'f32le', '-'])
            samples = np.frombuffer(decoded, dtype='<f4').astype(np.float64)
            samples -= np.mean(samples)
            waves[identifier] = samples
        pairs = []
        for index, left in enumerate(identifiers):
            for right in identifiers[index + 1:]:
                length = min(len(waves[left]), len(waves[right]))
                a, b = waves[left][:length], waves[right][:length]
                corr = float(np.dot(a, b) / max(np.linalg.norm(a) * np.linalg.norm(b), 1e-20))
                pairs.append({'left': left, 'right': right, 'zeroLagCorrelation': corr})
                if abs(corr) >= .1:
                    raise ValueError(f'Unexpected strongly correlated residue waveforms: {left}, {right}')
        results[kind] = pairs
    return results


def main():
    helper, tools = load_helpers()
    batches = {name: json.loads((ASSETS / name).read_text()) for name in BATCHES}
    if any(batch['status'] != 'complete' for batch in batches.values()):
        raise ValueError('Both local generation batches must complete first')
    presets = {row['id']: row for row in json.loads(PACK.read_text())['assets']}
    results = []
    sources = {}
    row, source = finish(PHONE_ID, PHONE_GENERATION, 'phone-crackle', 'Dry branches and leaves',
                         'A new independent dry wooden branch and leaf crackle, with restrained low weight and clear fine woody detail.',
                         batches, helper, tools)
    results.append(row)
    sources[PHONE_ID] = source
    for kind, identifiers in NEW_RESIDUES.items():
        for identifier in identifiers:
            preset = presets[identifier]
            row, source = finish(identifier, identifier, kind, preset['title'], preset['role'], batches, helper, tools)
            results.append(row)
            sources[identifier] = source
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    previous_morphs = json.loads(json.dumps(manifest['morphs']))
    replacement_ids = {row['id'] for row in results}
    manifest['assets'] = [row for row in manifest['assets'] if row['id'] not in replacement_ids] + results
    manifest['version'] = 10
    manifest['phone']['crackle'] = PHONE_ID
    manifest['phone']['crackleAlternatives'] = [PHONE_ID, 'phone-branches-full', 'phone-branches-leaves']
    manifest['residueVariations'] = VARIATIONS
    if len(manifest['assets']) > 40 or manifest['morphs'] != previous_morphs:
        raise ValueError('Catalog exceeds its limit or unexpectedly changes global morphs')
    correlations = waveform_correlations(manifest, tools)
    validation = {
        'completedAt': now(), 'catalogRevision': manifest['version'], 'activeAssetCount': len(manifest['assets']),
        'model': batches[BATCHES[0]]['model'], 'backend': batches[BATCHES[0]]['backend'],
        'newIds': [row['id'] for row in results], 'phoneDefault': PHONE_ID,
        'selectedPhoneGeneration': PHONE_GENERATION,
        'retainedUnselectedPhoneGenerationIds': ['phone-branches-dry-v20-study2', 'phone-wood-body-v20-study3', 'phone-wood-body-v20-study4'],
        'residueVariations': VARIATIONS, 'globalMorphsUnchanged': manifest['morphs'] == previous_morphs,
        'independence': 'Six new residue variations have distinct prompts, seeds and genuinely independently inferred float masters. No offset, time-stretched, pitch-shifted or repeated copies were used as extra variations.',
        'decodedWaveformCorrelation': correlations,
        'correlationScope': 'First 18 s, mono11025Hz, mean removed, equal-position normalized dot product. A low value rejects directly duplicated concurrent waveforms; it does not certify perceived diversity or prompt adherence.',
        'assets': {identifier: {'generationId': source['generationId'],
                                'rawMasterHashUnchanged': source['sourceMasterUnchangedCheck'],
                                'browser': source['browserAsset'], 'mobile': source['mobile']}
                   for identifier, source in sources.items()},
        'listeningReview': 'Not certified by a human listener. Technical validation does not establish prompt adherence.',
    }
    helper.save(ASSETS / 'residue-v20-validation.json', validation)
    helper.save(manifest_path, manifest)
    print(json.dumps({'activeAssets': len(manifest['assets']), 'newIds': validation['newIds'],
                      'phoneDefault': PHONE_ID, 'selectedPhoneGeneration': PHONE_GENERATION}, indent=2))


if __name__ == '__main__':
    main()
