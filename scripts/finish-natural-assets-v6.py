#!/usr/bin/env python3
"""Prepare documented CC0 field-recording excerpts without dynamic processing.

Public HQ preview downloads and source-page snapshots are retained unchanged.
This script does not download audio, generate sound, or alter old masters.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
PACK = ROOT / 'scripts/natural-assets-v6.json'
EDGE = .005


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(path),
                                   '-ar', '44100', '-ac', '2', '-f', 'f32le', '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)


def envelope_metrics(samples):
    # Ignore the edge click guards when measuring steadiness.
    samples = samples[44100:-44100]
    width = 22050
    frames = samples[:len(samples) // width * width].reshape(-1, width, 2)
    env = np.sqrt(np.mean(frames ** 2, axis=(1, 2)))
    db = 20 * np.log10(np.maximum(env, 1e-12))
    fine = samples[:len(samples) // 441 * 441].reshape(-1, 441, 2)
    fine_env = np.sqrt(np.mean(fine ** 2, axis=(1, 2)))
    centered = fine_env - fine_env.mean()
    corr = np.correlate(centered, centered, mode='full')[len(centered)-1:]
    corr /= max(corr[0], 1e-12)
    lag = 20 + int(np.argmax(corr[20:201]))
    return {
        'windowSeconds': .5,
        'windowRmsP95MinusP5Db': float(np.percentile(db, 95) - np.percentile(db, 5)),
        'windowRmsStandardDeviationDb': float(db.std()),
        'windowRmsMaxMinusMinDb': float(db.max() - db.min()),
        'envelope10msModulationIndex': float(fine_env.std() / max(fine_env.mean(), 1e-12)),
        'largestEnvelopeAutocorrelationWithin0p2To2': float(corr[lag]),
        'largestEnvelopeAutocorrelationLagSecondsWithin0p2To2': lag / 100,
        'scope': 'Signal amplitude evidence only. Natural rainfall intensity and insect pulse gaps may vary; these measurements do not identify sources or certify perceptual absence of pumping.',
    }


def main():
    pack = json.loads(PACK.read_text())
    spec = importlib.util.spec_from_file_location('wildfire_signal_metrics', ROOT / 'scripts/stablegen-v3-textures.py')
    finish = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(finish)
    results = {}
    for preset in pack['assets']:
        identifier = preset['id']
        preview = ASSETS / 'natural-sources' / f"{preset['sourceKey']}-preview.mp3"
        page = ASSETS / 'natural-sources' / f"{preset['sourceKey']}-page.html"
        page_text = page.read_text()
        if 'creativecommons.org/publicdomain/zero/1.0' not in page_text or preset['sourcePreviewUrl'] not in page_text:
            raise ValueError(f'CC0/source preview evidence is missing: {identifier}')
        duration, start = preset['durationSeconds'], preset['sourceStartSeconds']
        working = ASSETS / f'{identifier}.working.wav'
        filters = [f"highpass=f={preset['highpassHz']}:p=2"] if preset.get('highpassHz') else []
        command = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(start), '-i', str(preview), '-t', str(duration)]
        if filters:
            command += ['-af', ','.join(filters)]
        command += ['-ar', '44100', '-ac', str(preset['channels']), '-c:a', 'pcm_f32le', str(working)]
        subprocess.run(command, check=True)
        source_samples = decode(working)
        peak_db = float(20 * np.log10(max(np.max(np.abs(source_samples)), 1e-12)))
        # Fixed gain for the whole excerpt. No AGC, compression, denoise,
        # loudness riding, limiting, rhythmic edits, pitch shift or layering.
        gain = preset.get('constantGainDb', -5 - peak_db)
        output = ASSETS / f'{identifier}.mp3'
        try:
            for _ in range(4):
                export_filters = f'afade=t=in:st=0:d={EDGE},afade=t=out:st={duration-EDGE}:d={EDGE},volume={gain:.9f}dB'
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(working), '-af', export_filters,
                                '-map_metadata', '-1', '-ar', '44100', '-ac', str(preset['channels']),
                                '-c:a', 'libmp3lame', '-b:a', '192k', str(output)], check=True)
                measured = finish.audio_metrics(output)
                if measured['nonFiniteSamples'] or measured['samplesPerChannel'] != duration * 44100:
                    raise ValueError(f'Incomplete or invalid audio: {identifier}')
                if measured['peakDbfs'] <= -3:
                    break
                gain -= measured['peakDbfs'] + 3.25
            else:
                raise ValueError(f'Encoded peak exceeds ceiling: {identifier}')
        finally:
            working.unlink(missing_ok=True)
        envelope = envelope_metrics(decode(output))
        processing = (f"Select source seconds {start}–{start + duration}; "
                      + (f"{preset['highpassHz']} Hz two-pole high-pass to remove low background wash; " if filters else '')
                      + f"fixed {gain:.6f} dB gain throughout, 5 ms click guards at both boundaries, "
                      + f"{preset['channels']}-channel 44.1 kHz 192 kbps MP3. "
                      + "No added compression, AGC, limiting, noise gate, dynamic denoise, envelope riding, time/pitch change, artificial pulse, or added layer. Runtime circular overlap handles the loop seam. The downloaded public preview is retained byte-for-byte; original uncompressed source was not downloaded.")
        source = {
            **preset, 'status': 'prepared', 'generated': False, 'fieldRecording': True,
            'assetKind': 'excerpt-of-cc0-field-recording-public-preview',
            'retrievedOn': pack['retrievedOn'],
            'sourceUrl': f"https://freesound.org/people/{preset['author']}/sounds/{preset['freesoundId']}/",
            'license': 'CC0 1.0 Universal', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'preview': True, 'access': 'Public HQ MP3 preview, without login, account, or paid service; original WAV download requires Freesound login.',
            'sourcePreview': {'file': str(preview.relative_to(ROOT)), 'bytes': preview.stat().st_size, 'sha256': digest(preview), 'url': preset['sourcePreviewUrl']},
            'sourcePageEvidence': {'file': str(page.relative_to(ROOT)), 'bytes': page.stat().st_size, 'sha256': digest(page), 'checkedLicense': 'CC0 1.0 Universal'},
            'browserAsset': {'file': output.name, 'bytes': output.stat().st_size, 'sha256': digest(output),
                             'durationSeconds': duration, 'sampleRate': 44100, 'channels': preset['channels'], 'bitrateKbps': 192},
            'processing': processing,
            'normalization': {'targetPeakCeilingDbfsBeforeEncoding': -5, 'appliedConstantGainDb': gain,
                              'sharedSourceGain': preset.get('constantGainDb') is not None},
            'validation': {**measured, 'encodedPeakCeilingDbfs': -3, 'encodedPeakCheck': 'passed', 'envelope': envelope},
            'playbackBoundary': {'fadeInSeconds': EDGE, 'fadeOutSeconds': EDGE, 'loopConditioning': 'runtime-circular-overlap'},
            'listeningReview': 'Source-page descriptions, waveform and spectrogram inspection, and signal/envelope measurements; no human listening certification.',
        }
        finish.write_json(ASSETS / f'{identifier}-source.json', source)
        results[identifier] = {'browserSha256': digest(output), 'browser': measured, 'envelope': envelope}
        print(identifier, json.dumps({'peakDbfs': measured['peakDbfs'], 'rmsDbfs': measured['rmsDbfs'], **envelope}), flush=True)
    finish.write_json(ASSETS / 'natural-assets-validation.json', {
        'version': 6, 'assets': results, 'selectionNotes': pack['selectionNotes'],
        'rainSourceIndependence': 'Both rain assets use non-overlapping 40-second excerpts from one natural field recording; they are not represented as independent recordings.',
    })


if __name__ == '__main__':
    main()
