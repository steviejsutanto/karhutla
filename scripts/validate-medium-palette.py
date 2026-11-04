#!/usr/bin/env python3
"""Measure the published palette and its exact unchanged model sources.

Envelope measures describe amplitude timing, not a listening certification.
They are useful for exposing steady background or strongly isolated attacks.
"""
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'


def envelope_metrics(path):
    raw = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(path), '-ar', '44100', '-ac', '2', '-f', 'f32le', '-'])
    samples = np.frombuffer(raw, dtype='<f4').astype(np.float64).reshape(-1, 2)
    width = 441  # 10 ms envelope.
    frames = samples[:len(samples) // width * width].reshape(-1, width, 2)
    envelope = np.sqrt(np.mean(frames ** 2, axis=(1, 2)))
    envelope = envelope[100:-100]  # Ignore boundary fades in cadence metrics.
    floor = 1e-12
    db = 20 * np.log10(np.maximum(envelope, floor))
    centered = envelope - envelope.mean()
    correlation = np.correlate(centered, centered, mode='full')[len(centered)-1:]
    correlation /= max(correlation[0], floor)
    start, end = 20, min(201, len(correlation))
    index = start + int(np.argmax(correlation[start:end]))
    return {
        'envelopeWindowMs': 10,
        'envelopeModulationIndex': float(envelope.std() / max(envelope.mean(), floor)),
        'quietGapFractionBelowP90Minus18Db': float(np.mean(db < np.percentile(db, 90) - 18)),
        'envelopeP90MinusP10Db': float(np.percentile(db, 90) - np.percentile(db, 10)),
        'largestEnvelopeAutocorrelationLagSecondsWithin0p2To2': index / 100,
        'largestEnvelopeAutocorrelationWithin0p2To2': float(correlation[index]),
        'positive10msEnvelopeRiseP99Db': float(np.percentile(np.maximum(0, np.diff(db)), 99)),
        'scope': 'Signal envelope evidence only. A correlation peak does not prove a regular natural cricket call, and spectral energy does not identify a source.'
    }


def main():
    spec = importlib.util.spec_from_file_location('wildfire_signal_metrics', ROOT / 'scripts/stablegen-v3-textures.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    presets = json.loads((ROOT / 'scripts/stablegen-v4-palette-prompts.json').read_text())['assets']
    results = {}
    for preset in presets:
        identifier = preset['id']
        source = json.loads((ASSETS / f'{identifier}-source.json').read_text())
        proof = source.get('sourceGeneration', source)
        master = ASSETS / proof['master']['file']
        browser = ASSETS / source['browserAsset']['file']
        measured = module.audio_metrics(browser)
        browser_hash_matches = module.sha256(browser) == source['browserAsset']['sha256']
        if measured['nonFiniteSamples'] or measured['samplesPerChannel'] != 45 * 44100 or measured['peakDbfs'] > -3 or module.sha256(master) != proof['master']['sha256'] or not browser_hash_matches:
            raise ValueError(f'Published signal or unchanged source verification failed: {identifier}')
        results[identifier] = {'kind': preset['kind'], 'sourceFloatMasterSha256Verified': True,
                               'browserSha256Verified': browser_hash_matches,
                               'browser': measured, 'envelope': envelope_metrics(browser),
                               'rawSourceEnvelope': envelope_metrics(master)}
    document = {'model': 'Stable Audio 3 Medium', 'assets': results,
                'limitations': 'Complete decoding, source hashes, headroom, spectral energy and envelope measurements verified. Human perceptual prompt adherence is not certified.'}
    (ASSETS / 'palette-validation.json').write_text(json.dumps(document, indent=2)+'\n')
    for identifier, row in results.items():
        print(identifier, json.dumps({'peakDbfs': row['browser']['peakDbfs'], 'rmsDbfs': row['browser']['rmsDbfs'],
                                     'sub120Fraction': row['browser']['spectralEnergyFractions']['0-120Hz'],
                                     'above6kFraction': row['browser']['spectralEnergyFractions']['6000-22050Hz'],
                                     **row['envelope']}))


if __name__ == '__main__':
    main()
