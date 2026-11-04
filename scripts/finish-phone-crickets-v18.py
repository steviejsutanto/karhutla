#!/usr/bin/env python3
"""Compact mono derivatives of the three already licensed cricket assets.

Preserves every existing base file and provenance file. Separate derivative
records identify the exact base asset/hash and field-recording provenance.
"""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
EXCERPTS = {'cricket-far': 11, 'cricket-mid': 8, 'cricket-near': 4}
DURATION = 18


def main():
    spec = importlib.util.spec_from_file_location('wildfire_finish', ROOT / 'scripts/stablegen-v3-textures.py')
    tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tools)
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    rows = {row['id']: row for row in manifest['assets']}
    results = []
    for identifier, start in EXCERPTS.items():
        row = rows[identifier]
        base = ROOT / row['file']
        if tools.sha256(base) != row['sha256']:
            raise ValueError(f'Catalog base audio hash mismatch: {identifier}')
        source = json.loads((ROOT / row['provenanceFile']).read_text())
        output = ASSETS / f'{identifier}-mobile.mp3'
        gain = 0.0
        for attempt in range(3):
            filters = f'afade=t=in:st=0:d=0.005,afade=t=out:st={DURATION-.005}:d=0.005,volume={gain:.9f}dB'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(start), '-i', str(base),
                            '-t', str(DURATION), '-af', filters, '-ar', '44100', '-ac', '1', '-map_metadata', '-1',
                            '-c:a', 'libmp3lame', '-b:a', '96k', str(output)], check=True)
            metrics = tools.audio_metrics(output)
            if metrics['nonFiniteSamples'] or metrics['samplesPerChannel'] != DURATION * 44100:
                raise ValueError(f'Incomplete or nonfinite mobile cricket decode: {identifier}')
            if metrics['peakDbfs'] <= -3:
                break
            gain -= metrics['peakDbfs'] + 3.25
        else:
            raise ValueError(f'Encoded cricket peak check failed: {identifier}')
        record = {
            'id': identifier + '-mobile', 'generated': False, 'fieldRecording': True,
            'assetKind': 'mobile-derivative-of-published-cc0-field-recording-preview',
            'file': 'audio-assets/v3/' + output.name, 'bytes': output.stat().st_size, 'sha256': tools.sha256(output),
            'durationSeconds': DURATION, 'sampleRate': 44100, 'channels': 1, 'bitrateKbps': 96,
            'sourceFile': row['file'], 'sourceSha256': row['sha256'],
            'sourceProvenanceFile': row['provenanceFile'],
            'sourceExcerptStartSeconds': start, 'sourceExcerptEndSeconds': start + DURATION,
            **{key: source[key] for key in ('sourceUrl', 'license', 'licenseUrl', 'author', 'sourceTitle', 'freesoundId')},
            'sourcePreview': source['sourcePreview'],
            'processing': f'Select published asset seconds{start}–{start+DURATION}; mono downmix at44.1kHz, '
                          f'5ms boundary click guards and fixed{gain:.9f}dB additional gain. Encode96kbps MP3. '
                          'Base audio and provenance remain unchanged. Existing source high-pass and fixed gain '
                          'are inherited from the published asset. No new filtering, compression, AGC, imposed '
                          'rhythm, time/pitch change, synthesis or added layer. Runtime circular overlap handles the seam.',
            'normalization': {'appliedConstantGainDb': gain, 'targetPeakCeilingDbfs': -3},
            'validation': {**metrics, 'encodedPeakCeilingDbfs': -3, 'encodedPeakCheck': 'passed'},
            'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
            'completedAt': datetime.now(timezone.utc).isoformat(),
        }
        tools.write_json(ASSETS / f'{identifier}-mobile-source.json', record)
        row['mobile'] = {key: record[key] for key in ('file', 'bytes', 'sha256', 'durationSeconds', 'sampleRate',
                         'channels', 'bitrateKbps', 'assetKind', 'sourceFile', 'sourceSha256',
                         'sourceExcerptStartSeconds', 'sourceExcerptEndSeconds', 'processing', 'validation', 'playbackBoundary')}
        row['mobile']['provenanceFile'] = 'audio-assets/v3/' + identifier + '-mobile-source.json'
        results.append({'id': identifier, **row['mobile']})
    manifest['phone']['cricketLayers'] = list(EXCERPTS)
    manifest['version'] = max(9, manifest['version'])
    tools.write_json(manifest_path, manifest)
    tools.write_json(ASSETS / 'phone-crickets-v18-validation.json', {
        'status': 'complete', 'assets': results,
        'scope': 'Full decode/sample count, zero nonfinite samples, final hashes and headroom validated; no human listening certification.'})
    print(json.dumps([{'id': row['id'], 'file': row['file'], 'bytes': row['bytes'],
                       'rmsDbfs': row['validation']['rmsDbfs'], 'peakDbfs': row['validation']['peakDbfs']} for row in results], indent=2))


if __name__ == '__main__':
    main()
