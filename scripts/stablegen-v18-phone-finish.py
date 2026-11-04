#!/usr/bin/env python3
"""Finish proven local Medium quench events and a fuller phone crackle bed.

No inference or sound synthesis occurs here. Original float model masters
and completed generation records must match their recorded SHA-256 hashes.
The derivatives use only documented excerpts, filtering, compression,
fixed mixing, fades, and one MP3 encode from the processed float signal.
"""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
BATCH = ASSETS / 'medium-phone-v18-batch.json'
RATE = 44100
QUENCH_EXCERPTS = {
    'phone-quench-ember': ('phone-quench-ember-warm', .15, 1.95),
    'phone-quench-wood': ('phone-quench-wood-soft', .4, 2.1),
    'phone-quench-leaf': ('phone-quench-leaf', .78, 2.25),
    'phone-quench-steam': ('phone-quench-steam', .72, 2.4),
}


def now():
    return datetime.now(timezone.utc).isoformat()


def load_tools():
    spec = importlib.util.spec_from_file_location('wildfire_finish', ROOT / 'scripts/stablegen-v3-textures.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def run(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)], check=True)


def proof(identifier, batch, tools):
    row = json.loads((ASSETS / f'{identifier}-generation.json').read_text())
    master = ASSETS / row['master']['file']
    recorded = batch['assets'].get(identifier, {})
    if (row.get('generated') is not True or row.get('status') != 'generated'
            or tools.sha256(master) != row['master']['sha256']
            or recorded.get('master', {}).get('sha256') != row['master']['sha256']):
        raise ValueError(f'Completed genuine generation with matching master required: {identifier}')
    return row, master


def encode(working, output, duration, tools, *, channels, bitrate, target_rms, peak_ceiling):
    metrics = tools.audio_metrics(working)
    gain = min(target_rms - metrics['rmsDbfs'], peak_ceiling - 1 - metrics['peakDbfs'])
    correction = 0.0
    for attempt in range(4):
        run('-i', working, '-af', f'volume={gain:.9f}dB', '-ar', RATE, '-ac', channels,
            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', output)
        decoded = tools.audio_metrics(output)
        if decoded['nonFiniteSamples'] or decoded['samplesPerChannel'] != round(duration * RATE):
            raise ValueError(f'Incomplete or non-finite encoded audio: {output}')
        if decoded['peakDbfs'] <= peak_ceiling:
            break
        adjustment = decoded['peakDbfs'] - peak_ceiling + .3
        gain -= adjustment
        correction += adjustment
    else:
        raise ValueError(f'Encoded headroom check failed: {output}')
    return {
        'file': output.name, 'bytes': output.stat().st_size, 'sha256': tools.sha256(output),
        'durationSeconds': duration, 'channels': channels, 'sampleRate': RATE, 'bitrateKbps': bitrate,
        'normalization': {'targetRmsDbfs': target_rms, 'peakCeilingDbfs': peak_ceiling,
                          'appliedGainDb': gain, 'codecHeadroomCorrectionDb': correction},
        'validation': {**decoded, 'encodedPeakCeilingDbfs': peak_ceiling, 'encodedPeakCheck': 'passed'},
    }


def catalog_row(source, browser, mobile=None):
    row = {key: source[key] for key in ('id', 'kind', 'title', 'description', 'model', 'sourceUrl', 'modelUrl',
           'license', 'licenseUrl', 'generated', 'assetKind', 'rawModelOutput', 'processing')}
    row.update({key: browser[key] for key in ('durationSeconds', 'bytes', 'bitrateKbps', 'sha256', 'validation')})
    row['file'] = 'audio-assets/v3/' + browser['file']
    row['provenanceFile'] = 'audio-assets/v3/' + source['id'] + '-source.json'
    row['generationBatchRecord'] = source['generationBatchRecord']
    row['mobile'] = {**(mobile or browser), 'file': 'audio-assets/v3/' + (mobile or browser)['file']}
    row['playbackBoundary'] = source['playbackBoundary']
    return row


def finish_quench(identifier, batch, tools):
    generation_id, start, duration = QUENCH_EXCERPTS[identifier]
    generation, master = proof(generation_id, batch, tools)
    working = ASSETS / f'{identifier}.working.wav'
    # A very fast soft compressor restrains isolated model spikes; the
    # source's own hiss/sputter carries the sound. Only its end is tapered.
    fade_out = .52
    filters = ('highpass=f=160:p=2,lowpass=f=6800:p=2,'
               'acompressor=threshold=0.012:ratio=2.8:attack=0.2:release=65:knee=2.8:makeup=1,'
               f'afade=t=in:st=0:d=0.012,afade=t=out:st={duration-fade_out}:d={fade_out}')
    try:
        run('-ss', start, '-i', master, '-t', duration, '-af', filters,
            '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', working)
        browser = encode(working, ASSETS / f'{identifier}.mp3', duration, tools,
                         channels=1, bitrate=96, target_rms=-28, peak_ceiling=-9)
    finally:
        working.unlink(missing_ok=True)
    source = {
        'id': identifier, 'kind': 'phone-quench', 'title': generation['title'],
        'description': generation['role'],
        **{key: generation[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
        'generated': True, 'assetKind': 'processed-derivative-of-genuine-model-output', 'rawModelOutput': False,
        'sourceGeneration': generation, 'verifiedWeights': batch['verifiedWeights'], 'device': batch['device'],
        'generationBatchRecord': batch.get('supplementalGenerationIds', {}).get(generation_id, BATCH.name),
        'masterValidation': tools.audio_metrics(master),
        'sourceExcerptStartSeconds': start, 'sourceExcerptEndSeconds': start + duration,
        'processing': f'Select {start:.2f}–{start+duration:.2f}s directly from the unchanged genuine float model master. '
                      'Mono downmix, 160Hz two-pole high-pass, 6800Hz two-pole low-pass; soft compressor '
                      'threshold 0.012/ratio 2.8/attack 0.2ms/release 65ms/knee 2.8/makeup 1; '
                      '12ms attack click guard and 520ms ending taper; fixed gain toward -28dBFS RMS, '
                      'constrained to conservative peak headroom; mono44.1kHz96kbps MP3 encoded once from processed float. '
                      'No reverb, delay, pitch/speed change, added sound, or synthesized noise.',
        'browserAsset': browser, 'mobile': browser, 'validation': browser['validation'],
        'playbackBoundary': {'oneShot': True, 'fadeInSeconds': .012, 'fadeOutSeconds': fade_out},
        'listeningReview': 'Signal and provenance checks passed. No human listening certification; generated source identity and absence of voices or music require audition.',
        'completedAt': now(),
    }
    save(ASSETS / f'{identifier}-source.json', source)
    return catalog_row(source, browser), source


def finish_body(batch, tools):
    identifier = 'phone-branches-full'
    duration = 18
    first, first_master = proof('phone-branches-body-take1', batch, tools)
    second, second_master = proof('phone-branches-body-take2', batch, tools)
    working = ASSETS / f'{identifier}.working.wav'
    mono = ASSETS / f'{identifier}.mono.working.wav'
    # The primary take supplies the newly generated woody middle register;
    # a quieter independent take fills the gaps between individual snaps.
    mix = ('[0:a]atrim=start=6:duration=18,asetpts=PTS-STARTPTS,'
           'highpass=f=150:p=2,lowpass=f=6500:p=2,equalizer=f=900:t=o:w=2:g=3[a];'
           '[1:a]atrim=start=4:duration=18,asetpts=PTS-STARTPTS,'
           'highpass=f=350:p=2,lowpass=f=5200:p=2,volume=0.65[b];'
           '[a][b]amix=inputs=2:duration=shortest:normalize=0,'
           'acompressor=threshold=0.007:ratio=3.5:attack=0.12:release=60:knee=2.8:makeup=1,'
           'afade=t=in:st=0:d=0.005,afade=t=out:st=17.995:d=0.005[out]')
    try:
        run('-i', first_master, '-i', second_master, '-filter_complex', mix, '-map', '[out]',
            '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', working)
        browser = encode(working, ASSETS / f'{identifier}.mp3', duration, tools,
                         channels=2, bitrate=160, target_rms=-27.5, peak_ceiling=-7)
        run('-i', working, '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', mono)
        mobile = encode(mono, ASSETS / f'{identifier}-mobile.mp3', duration, tools,
                        channels=1, bitrate=96, target_rms=-27.5, peak_ceiling=-7)
    finally:
        working.unlink(missing_ok=True)
        mono.unlink(missing_ok=True)
    source = {
        'id': identifier, 'kind': 'phone-crackle', 'title': 'Burning branches and leaves',
        'description': 'A thicker layered woodfire bed, with warm woody twig body and dry papery leaf crackles.',
        **{key: first[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
        'generated': True, 'assetKind': 'processed-blend-of-genuine-model-outputs', 'rawModelOutput': False,
        'sourceGenerations': [first, second], 'verifiedWeights': batch['verifiedWeights'], 'device': batch['device'],
        'generationBatchRecord': BATCH.name,
        'sourceExcerpts': [{'generationId': first['id'], 'startSeconds': 6, 'endSeconds': 24, 'linearMixGain': 1},
                           {'generationId': second['id'], 'startSeconds': 4, 'endSeconds': 22, 'linearMixGain': .65}],
        'processing': 'Mix two genuine independently generated float takes: take1 seconds6–24 at unity, with '
                      '150Hz two-pole high-pass/6500Hz two-pole low-pass and +3dB 900Hz two-octave equalizer; '
                      'take2 seconds4–22 at linear gain0.65, with350Hz two-pole high-pass/5200Hz two-pole low-pass. '
                      'No mix normalization. Soft compressor threshold0.007/ratio3.5/attack0.12ms/release60ms/'
                      'knee2.8/makeup1 restrains isolated snaps. Five-millisecond boundary click guards; fixed '
                      'gain toward-27.5dBFS RMS constrained to conservative peak headroom. Stereo44.1kHz160kbps '
                      'desktop MP3 and mono44.1kHz96kbps mobile MP3 encoded independently from processed float. '
                      'Raw masters retained unchanged. No external recording, synthesized noise, reverb, delay, or speed/pitch change.',
        'browserAsset': browser, 'mobile': mobile, 'validation': browser['validation'],
        'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
        'listeningReview': 'Signal and provenance checks passed. No human listening certification of burning source identity, dryness, or absence of music.',
        'completedAt': now(),
    }
    save(ASSETS / f'{identifier}-source.json', source)
    return catalog_row(source, browser, mobile), source


def main():
    tools = load_tools()
    batch = json.loads(BATCH.read_text())
    if batch['status'] != 'complete':
        raise ValueError('The genuine local generation batch must finish first')
    retry_path = ASSETS / 'medium-quench-v18-retry-batch.json'
    retry = json.loads(retry_path.read_text())
    if retry['status'] != 'complete' or retry['verifiedWeights'] != batch['verifiedWeights']:
        raise ValueError('The supplemental batch must be complete and use the same verified model weights')
    batch['assets'].update(retry['assets'])
    batch['supplementalGenerationIds'] = {identifier: retry_path.name for identifier in retry['assets']}
    rows, sources = [], []
    for identifier in QUENCH_EXCERPTS:
        row, source = finish_quench(identifier, batch, tools)
        rows.append(row)
        sources.append(source)
    row, source = finish_body(batch, tools)
    rows.append(row)
    sources.append(source)
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    identifiers = {row['id'] for row in rows}
    manifest['assets'] = [row for row in manifest['assets'] if row['id'] not in identifiers] + rows
    manifest['phone']['quench'] = list(QUENCH_EXCERPTS)
    manifest['phone']['crackle'] = 'phone-branches-full'
    manifest['version'] = max(9, manifest['version'])
    save(manifest_path, manifest)
    previous = json.loads((ASSETS / 'phone-branches-leaves-source.json').read_text())['mobile']['validation']
    current = source['mobile']['validation']
    validation = {
        'status': 'complete', 'createdAt': now(), 'generationBatch': BATCH.name,
        'additionalGenerationBatches': [retry_path.name],
        'unselectedGenerationIds': ['phone-quench-ember', 'phone-quench-wood'],
        'model': batch['model'], 'backend': batch['backend'],
        'quench': [{'id': s['id'], **s['browserAsset']} for s in sources[:-1]],
        'crackle': {'id': source['id'], 'mobile': source['mobile'],
                    'previousMobileRmsDbfs': previous['rmsDbfs'],
                    'previousMobileSpectralEnergyFractions': previous['spectralEnergyFractions'],
                    'newMobileRmsDbfs': current['rmsDbfs'],
                    'newMobileSpectralEnergyFractions': current['spectralEnergyFractions']},
        'scope': 'All exports fully decoded with exact sample counts, zero nonfinite samples and conservative peaks. '
                 'Signal evidence only; no human listening certification or perceptual identity guarantee.',
    }
    save(ASSETS / 'phone-v18-validation.json', validation)
    print(json.dumps({'manifestVersion': manifest['version'], 'assets': [
        {'id': s['id'], 'mobile': s['mobile']} for s in sources]}, indent=2))


if __name__ == '__main__':
    main()
