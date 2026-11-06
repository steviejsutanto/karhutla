#!/usr/bin/env python3
"""Shorter, more slowly spaced real cricket calls for compact phone playback.

Never change the full Main recordings or the prior mobile derivatives. New
files derive from the published CC0 previews; note waveforms keep their pitch.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import numpy as np
from scipy.signal import find_peaks, peak_widths

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
RATE = 32000
HOP = 160
SPACING = 1.25
NOTE_LENGTH = .65

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def decode(path):
    return np.frombuffer(subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-ar', str(RATE), '-ac', '1', '-f', 'f32le', '-']), dtype='<f4').astype(np.float64)

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

def main():
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    results = []
    for row in manifest['assets']:
        if row['id'] not in ('cricket-far', 'cricket-mid', 'cricket-near'):
            continue
        # The immutable v18 derivative is the source even on repeated runs.
        source = ASSETS / (row['id'] + '-mobile.mp3')
        provenance = json.loads((ASSETS / (row['id'] + '-mobile-source.json')).read_text())
        if digest(source) != provenance['sha256']:
            raise ValueError('The previous mobile source has changed: ' + row['id'])
        x = decode(source)
        envelope = np.sqrt(np.mean(x[:len(x)//HOP*HOP].reshape(-1, HOP)**2, axis=1))
        peaks, _ = find_peaks(envelope, distance=18, prominence=np.percentile(envelope, 80) * .35)
        widths, _, left, right = peak_widths(envelope, peaks, rel_height=.72)
        seconds = min(20, len(x) / RATE * SPACING)
        output = np.zeros(round(seconds * RATE), dtype=np.float64)
        # A very quiet real-recording undercurrent prevents a sterile on/off
        # feel. Foreground natural chirps retain a much stronger contrast.
        output += np.resize(x, len(output)) * .04
        events = []
        for index, peak in enumerate(peaks):
            old_duration = min(.16, max(.016, widths[index] * HOP / RATE))
            new_duration = old_duration * NOTE_LENGTH
            center = int(peak * HOP + HOP / 2)
            size = max(16, round(new_duration * RATE))
            first = max(0, center - size // 2)
            note = x[first:first+size].copy()
            fade = min(len(note)//3, max(16, round(.003 * RATE)))
            edge = .5 - .5 * np.cos(np.linspace(0, np.pi, fade))
            note[:fade] *= edge; note[-fade:] *= edge[::-1]
            target = round(center * SPACING) - len(note)//2
            if target < 0 or target + len(note) > len(output):
                continue
            output[target:target+len(note)] += note
            events.append({'sourceCenterSeconds': center / RATE, 'targetCenterSeconds': center / RATE * SPACING,
                           'sourceEnvelopeSeconds': old_duration, 'targetEnvelopeSeconds': len(note) / RATE})
        gain = min(.055 / max(np.sqrt(np.mean(output**2)), 1e-8), .7 / max(np.max(np.abs(output)), 1e-8))
        output *= gain
        guard = round(.01 * RATE)
        edge = .5 - .5 * np.cos(np.linspace(0, np.pi, guard))
        output[:guard] *= edge; output[-guard:] *= edge[::-1]
        raw = ASSETS / (row['id'] + '-mobile-rhythm-v30-master.wav')
        mp3 = ASSETS / (row['id'] + '-mobile-rhythm-v30.mp3')
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-', '-c:a', 'pcm_f32le', str(raw)], input=output.astype('<f4').tobytes(), check=True)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(raw), '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '96k', str(mp3)], check=True)
        encoded = decode(mp3)
        if not np.all(np.isfinite(encoded)) or len(encoded) != len(output) or np.max(np.abs(encoded)) > .9:
            raise ValueError('Encoded cricket validation failed: ' + row['id'])
        source_intervals = np.diff([event['sourceCenterSeconds'] for event in events])
        target_intervals = np.diff([event['targetCenterSeconds'] for event in events])
        validation = {'samplesPerChannel': len(encoded), 'nonFiniteSamples': int(np.sum(~np.isfinite(encoded))),
                      'peakAmplitude': float(np.max(np.abs(encoded))), 'rms': float(np.sqrt(np.mean(encoded**2))),
                      'events': len(events), 'medianSourceIntervalSeconds': float(np.median(source_intervals)),
                      'medianTargetIntervalSeconds': float(np.median(target_intervals)),
                      'medianSourceNoteSeconds': float(np.median([event['sourceEnvelopeSeconds'] for event in events])),
                      'medianTargetNoteSeconds': float(np.median([event['targetEnvelopeSeconds'] for event in events])),
                      'pitchChange': 'none; original waveform excerpts, no resampling/time stretch'}
        record = {'id': row['id'] + '-mobile-rhythm-v30', 'generated': False, 'fieldRecording': True,
                  'assetKind': 'rhythm-edited-mobile-derivative-of-published-cc0-field-recording',
                  'file': 'audio-assets/v3/' + mp3.name, 'bytes': mp3.stat().st_size, 'sha256': digest(mp3),
                  'durationSeconds': seconds, 'sampleRate': RATE, 'channels': 1, 'bitrateKbps': 96,
                  'sourceFile': 'audio-assets/v3/' + source.name, 'sourceSha256': digest(source),
                  'originalRecordingFile': row['file'], 'originalRecordingSha256': row['sha256'],
                  'sourceProvenanceFile': 'audio-assets/v3/' + row['id'] + '-mobile-source.json',
                  **{key: provenance[key] for key in ('sourceUrl', 'license', 'licenseUrl', 'author', 'sourceTitle', 'freesoundId')},
                  'processing': 'Detect natural 5ms RMS envelope peaks with >=90ms separation; retain centered waveform excerpts at65% of each detected note envelope, 3ms cosine click guards; place onsets25% farther apart; add original recording undercurrent at−27.96dB. Crop at20seconds with10msedgeguards. No pitch/time stretch or synthesized chirps. Constant gain then96kbps mono32kHzMP3. Runtime playback staysat0.76, restoring previous pitch. No long phrase mutes.',
                  'spacingRatio': SPACING, 'noteDurationRatio': NOTE_LENGTH, 'events': events,
                  'validation': validation, 'completedAt': datetime.now(timezone.utc).isoformat()}
        provenance_path = ASSETS / (row['id'] + '-mobile-rhythm-v30-source.json')
        write(provenance_path, record)
        row['mobile'] = {key: record[key] for key in ('file', 'bytes', 'sha256', 'durationSeconds', 'sampleRate', 'channels', 'bitrateKbps', 'assetKind', 'sourceFile', 'sourceSha256', 'processing', 'validation')}
        row['mobile']['provenanceFile'] = 'audio-assets/v3/' + provenance_path.name
        results.append({'id': row['id'], **row['mobile']})
    # Merge only mobile fields into the latest catalog; other audio revisions
    # can edit unrelated entries while these files are being rendered.
    latest = json.loads(manifest_path.read_text())
    mobiles = {row['id']: {key: value for key, value in row.items() if key != 'id'} for row in results}
    for row in latest['assets']:
        if row['id'] in mobiles:
            row['mobile'] = mobiles[row['id']]
    write(manifest_path, latest)
    write(ASSETS / 'phone-crickets-v30-validation.json', {'status': 'complete', 'assets': results,
        'scope': 'Full decoded signal and deterministic note/spacing edits verified. Perceived timbre remains a listening judgment.'})
    print(json.dumps([{'id': row['id'], 'bytes': row['bytes'], **row['validation']} for row in results], indent=2))

if __name__ == '__main__':
    main()
