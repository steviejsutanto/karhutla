#!/usr/bin/env python3
"""Compact light-rain derivative from the retained licensed original preview.

The source-preview excerpt matches seconds 8–26 of the current published
rain-natural-light asset. Reusing the retained preview avoids another encode
of the already processed browser MP3. Only its original constant gain,
mono downmix, boundary guards, and mobile encoding are applied.
"""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
IDENTIFIER = 'rain-natural-light'
DURATION = 18
PUBLISHED_START = 8


def main():
    spec = importlib.util.spec_from_file_location('wildfire_finish', ROOT / 'scripts/stablegen-v3-textures.py')
    tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tools)
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    row = next(row for row in manifest['assets'] if row['id'] == IDENTIFIER)
    source = json.loads((ROOT / row['provenanceFile']).read_text())
    base = ROOT / row['file']
    preview = ROOT / source['sourcePreview']['file']
    if tools.sha256(base) != row['sha256'] or tools.sha256(preview) != source['sourcePreview']['sha256']:
        raise ValueError('Retained browser asset and original licensed source preview must match their recorded hashes')
    original_start = source['sourceStartSeconds'] + PUBLISHED_START
    gain = source['constantGainDb']
    output = ASSETS / f'{IDENTIFIER}-mobile.mp3'
    for _ in range(3):
        filters = f'volume={gain:.9f}dB,afade=t=in:st=0:d=0.005,afade=t=out:st={DURATION-.005}:d=0.005'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(original_start), '-i', str(preview),
                        '-t', str(DURATION), '-af', filters, '-ar', '44100', '-ac', '1', '-map_metadata', '-1',
                        '-c:a', 'libmp3lame', '-b:a', '96k', str(output)], check=True)
        metrics = tools.audio_metrics(output)
        if metrics['nonFiniteSamples'] or metrics['samplesPerChannel'] != DURATION * 44100:
            raise ValueError('Mobile light rain must decode completely without nonfinite samples')
        if metrics['peakDbfs'] <= -3:
            break
        gain -= metrics['peakDbfs'] + 3.25
    else:
        raise ValueError('Mobile light rain encoded peak check failed')
    record = {
        'id': IDENTIFIER + '-mobile', 'generated': False, 'fieldRecording': True,
        'assetKind': 'mobile-excerpt-of-retained-cc0-field-recording-preview',
        'file': 'audio-assets/v3/' + output.name, 'bytes': output.stat().st_size, 'sha256': tools.sha256(output),
        'durationSeconds': DURATION, 'sampleRate': 44100, 'channels': 1, 'bitrateKbps': 96,
        'sourceFile': source['sourcePreview']['file'], 'sourceSha256': source['sourcePreview']['sha256'],
        'publishedAssetFile': row['file'], 'publishedAssetSha256': row['sha256'],
        'sourceProvenanceFile': row['provenanceFile'],
        'sourceExcerptStartSeconds': original_start, 'sourceExcerptEndSeconds': original_start + DURATION,
        'publishedAssetEquivalentExcerptStartSeconds': PUBLISHED_START,
        'publishedAssetEquivalentExcerptEndSeconds': PUBLISHED_START + DURATION,
        **{key: source[key] for key in ('sourceUrl', 'license', 'licenseUrl', 'author', 'sourceTitle', 'freesoundId')},
        'sourcePreview': source['sourcePreview'],
        'processing': f'Select retained original public HQ MP3 preview seconds {original_start}–{original_start+DURATION}, '
                      f'equivalent to published rain-natural-light seconds {PUBLISHED_START}–{PUBLISHED_START+DURATION}. '
                      f'Apply the original fixed {gain:.9f} dB gain, mono downmix, 5 ms boundary click guards, '
                      'and encode once at 44.1 kHz/96 kbps MP3. Browser audio and its provenance remain unchanged. '
                      'No compression, AGC, limiting, noise gate, envelope riding, filtering, time/pitch change, '
                      'synthesis or added layer. Runtime circular overlap handles the seam. '
                      'The retained upstream public preview is compressed; an original microphone master is not claimed.',
        'normalization': {'appliedConstantGainDb': gain, 'sourcePublishedAssetConstantGainDb': source['constantGainDb'],
                          'targetPeakCeilingDbfs': -3},
        'validation': {**metrics, 'encodedPeakCeilingDbfs': -3, 'encodedPeakCheck': 'passed'},
        'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
        'sourcePreviewUnchangedCheck': tools.sha256(preview) == source['sourcePreview']['sha256'],
        'publishedAssetUnchangedCheck': tools.sha256(base) == row['sha256'],
        'listeningReview': 'Signal validation only; no human listening certification.',
        'completedAt': datetime.now(timezone.utc).isoformat(),
    }
    tools.write_json(ASSETS / f'{IDENTIFIER}-mobile-source.json', record)
    row['mobile'] = {key: record[key] for key in ('file', 'bytes', 'sha256', 'durationSeconds', 'sampleRate',
                     'channels', 'bitrateKbps', 'assetKind', 'sourceFile', 'sourceSha256',
                     'sourceExcerptStartSeconds', 'sourceExcerptEndSeconds', 'processing', 'validation', 'playbackBoundary')}
    row['mobile']['provenanceFile'] = 'audio-assets/v3/' + IDENTIFIER + '-mobile-source.json'
    manifest['phone']['rain'] = IDENTIFIER
    tools.write_json(manifest_path, manifest)
    tools.write_json(ASSETS / 'phone-rain-v20-validation.json', {'status': 'complete', 'asset': record})
    print(json.dumps({'id': IDENTIFIER, **row['mobile']}, indent=2))


if __name__ == '__main__':
    main()
