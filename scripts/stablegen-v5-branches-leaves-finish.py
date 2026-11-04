#!/usr/bin/env python3
"""Publish branch/leaf takes from verified genuine model masters.

Preserves the raw float masters byte-for-byte; browser derivatives receive
only 5 ms click guards and peak normalization. The phone runtime prepares
the circular loop. This file never runs inference or substitutes a source.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
PACK = ROOT / 'scripts/stablegen-v5-branches-leaves-prompts.json'
BATCH = ASSETS / 'medium-branches-leaves-batch.json'
EDGE_SECONDS = .005


def load_tools():
    spec = importlib.util.spec_from_file_location('wildfire_finish', ROOT / 'scripts/stablegen-v3-textures.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encode(raw, output, finish, *, start, duration, channels, bitrate):
    source_args = ['-ss', str(start)] if start else []
    # A separate float excerpt allows normalization against the intended
    # excerpt rather than the maximum elsewhere in the 45-second master.
    measured_path = output.with_suffix('.working.wav')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *source_args, '-i', str(raw), '-t', str(duration),
                    '-ar', '44100', '-ac', str(channels), '-c:a', 'pcm_f32le', str(measured_path)], check=True)
    excerpt_metrics = finish.audio_metrics(measured_path)
    gain = -4 - excerpt_metrics['peakDbfs']
    correction = 0.0
    try:
        for _ in range(4):
            filters = f'afade=t=in:st=0:d={EDGE_SECONDS},afade=t=out:st={duration - EDGE_SECONDS}:d={EDGE_SECONDS},volume={gain:.9f}dB'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(measured_path), '-af', filters,
                            '-ar', '44100', '-ac', str(channels), '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', str(output)], check=True)
            metrics = finish.audio_metrics(output)
            if metrics['nonFiniteSamples'] or metrics['samplesPerChannel'] != round(duration * 44100):
                raise ValueError(f'Incomplete/non-finite browser decode: {output}')
            if metrics['peakDbfs'] <= -3:
                break
            adjustment = metrics['peakDbfs'] + 3.25
            gain -= adjustment
            correction += adjustment
        else:
            raise ValueError(f'Encoded browser peak exceeds -3 dBFS: {output}')
    finally:
        measured_path.unlink(missing_ok=True)
    return {
        'file': output.name, 'bytes': output.stat().st_size, 'sha256': finish.sha256(output),
        'durationSeconds': duration, 'channels': channels, 'sampleRate': 44100, 'bitrateKbps': bitrate,
        'validation': {**metrics, 'encodedPeakCeilingDbfs': -3, 'encodedPeakCheck': 'passed'},
        'normalization': {'targetPeakDbfsBeforeEncoding': -4, 'appliedGainDb': gain, 'codecHeadroomCorrectionDb': correction},
        'playbackBoundary': {'fadeInSeconds': EDGE_SECONDS, 'fadeOutSeconds': EDGE_SECONDS, 'loopConditioning': 'runtime-circular-overlap'},
    }


def validate_proof(preset, batch, finish):
    proof = json.loads((ASSETS / (preset['id'] + '-generation.json')).read_text())
    raw = ASSETS / proof['master']['file']
    row = batch.get('assets', {}).get(preset['id'], {})
    if (proof.get('generated') is not True or proof.get('status') != 'generated'
        or proof['prompt'] != preset['prompt'] or proof['seed'] != preset['seed']
        or finish.sha256(raw) != proof['master']['sha256']
        or row.get('master', {}).get('sha256') != proof['master']['sha256']):
        raise ValueError(f'Exact completed genuine model generation required: {preset["id"]}')
    return proof, raw


def finish_one(identifier, preset, batch, finish, mobile):
    proof, raw = validate_proof(preset, batch, finish)
    desktop = encode(raw, ASSETS / f'{identifier}.mp3', finish, start=0, duration=45, channels=2, bitrate=160)
    metrics = finish.audio_metrics(raw)
    source = {
        **proof, 'id': identifier, 'generationId': preset['id'], 'title': 'Branches and leaves' if mobile else preset['title'],
        'kind': 'phone-crackle', 'assetKind': 'generated-model-output', 'rawModelOutput': True,
        'sourceGeneration': proof, 'verifiedWeights': batch['verifiedWeights'], 'device': batch['device'],
        'generationBatchRecord': BATCH.name,
        'wavMaster': proof['master'], 'masterValidation': metrics, 'browserAsset': desktop,
        'validation': desktop['validation'], 'normalization': desktop['normalization'],
        'playbackBoundary': desktop['playbackBoundary'],
        'processing': 'Genuine stereo 44.1 kHz float model master retained unchanged. Desktop copy: 5 ms fade at each edge solely as a click guard, peak normalization near -4 dBFS, stereo 44.1 kHz 160 kbps MP3. Encoded peak no higher than -3 dBFS verified. No filtering, compression, reverb, layering, or synthesized substitute. Runtime circular overlap prepares the phone loop.',
        'sourceMasterUnchangedCheck': finish.sha256(raw) == proof['master']['sha256'],
        'listeningReview': 'Not certified by a human listener. Signal measurements support take comparison but do not establish dry leaf/branch identity or absence of liquid character.',
        'finishedAt': datetime.now(timezone.utc).isoformat(),
    }
    if mobile:
        export = encode(raw, ASSETS / f'{identifier}-mobile.mp3', finish, start=8, duration=18, channels=1, bitrate=96)
        export['file'] = str((ASSETS / export['file']).relative_to(ROOT))
        export.update({
            'assetKind': 'mobile-derivative-of-genuine-model-output',
            'sourceFile': str(raw.relative_to(ROOT)), 'sourceSha256': proof['master']['sha256'],
            'sourceExcerptStartSeconds': 8, 'sourceExcerptEndSeconds': 26,
            'processing': 'Select raw generated seconds 8–26 directly from the unchanged float master; mono downmix, 44.1 kHz, 96 kbps MP3, 5 ms click guard at each edge and conservative peak normalization. No long export fades. Phone runtime circular overlap conditions the seam. No additional model generation or codec-to-codec conversion.',
        })
        source['mobile'] = export
    finish.write_json(ASSETS / f'{identifier}-source.json', source)
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--select', choices=['take1', 'take2'], required=True)
    args = parser.parse_args()
    finish = load_tools()
    pack = json.loads(PACK.read_text())
    batch = json.loads(BATCH.read_text())
    if batch.get('status') != 'complete':
        raise ValueError('Both genuine model generations must complete before finishing')
    presets = {p['id']: p for p in pack['assets']}
    selected = 'phone-branches-leaves-' + args.select
    alternate = next(key for key in presets if key != selected)
    active = finish_one('phone-branches-leaves', presets[selected], batch, finish, mobile=True)
    other = finish_one(alternate, presets[alternate], batch, finish, mobile=False)
    record = {
        'status': 'complete', 'selectedId': 'phone-branches-leaves', 'selectedGenerationId': selected,
        'alternateId': alternate, 'selectionScope': 'Signal comparison and prompt specificity; perceptual identity requires audition.',
        'assets': {active['id']: active, other['id']: other},
    }
    finish.write_json(ASSETS / 'branches-leaves-finishing.json', record)
    print(json.dumps({
        'selected': selected, 'desktopBytes': active['browserAsset']['bytes'], 'desktopPeakDbfs': active['validation']['peakDbfs'],
        'mobileBytes': active['mobile']['bytes'], 'mobilePeakDbfs': active['mobile']['validation']['peakDbfs'],
        'alternate': alternate,
    }, indent=2))


if __name__ == '__main__':
    main()
