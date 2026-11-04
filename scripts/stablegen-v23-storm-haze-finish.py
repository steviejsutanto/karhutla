#!/usr/bin/env python3
"""Publish new storm blends and airy haze from proven genuine local masters.

Only fixed filtering/gain, an explicitly placed actual thunder excerpt, and
short boundary fades are used. Rain is never compressed, gated, limited,
envelope-ridden, time-stretched, pitch-shifted, or replaced by synthesis.
"""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
RATE = 44100
BATCH_NAMES = ['medium-storm-haze-v23-batch.json', 'medium-rain-bed-v23-batch.json']
NEW_IDS = ['rain-storm-v23', 'rain-storm-v23-study2', 'haze-air-v23', 'haze-float-v23']
STORMS = {
    'rain-storm-v23': {
        'bed': 'rain-downpour-v23-bed2', 'thunder': 'rain-storm-v23-study2',
        'thunderSourceStart': 6.5, 'thunderSourceDuration': 8,
        'thunderOutputStart': 10, 'bedTargetRms': -28.5, 'thunderTargetRms': -29.5,
        'title': 'Heavy rain and deep distant thunder',
        'description': 'A new sustained heavy woodland rainfall with a soft deep rolling thunder event placed across the middle.'
    },
    'rain-storm-v23-study2': {
        'bed': 'rain-downpour-v23-bed1', 'thunder': 'rain-storm-v23',
        'thunderSourceStart': 2, 'thunderSourceDuration': 9,
        'thunderOutputStart': 10, 'bedTargetRms': -29, 'thunderTargetRms': -30.5,
        'title': 'Broad downpour and low rolling thunder',
        'description': 'An independent full downpour bed and a second soft low thunder roll, retained as a storm alternative.'
    },
}


def now():
    return datetime.now(timezone.utc).isoformat()


def helpers():
    spec = importlib.util.spec_from_file_location('wildfire_v23_finish', ROOT / 'scripts/stablegen-v18-phone-finish.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper, helper.load_tools()


def run(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)], check=True)


def proof(identifier, batches, tools):
    row = json.loads((ASSETS / f'{identifier}-generation.json').read_text())
    path = ASSETS / row['master']['file']
    matches = [name for name, batch in batches.items()
               if batch['assets'].get(identifier, {}).get('master', {}).get('sha256') == row['master']['sha256']]
    if (row.get('generated') is not True or row.get('status') != 'generated' or len(matches) != 1
            or tools.sha256(path) != row['master']['sha256']):
        raise ValueError(f'Completed genuine generation with unchanged exact master required: {identifier}')
    return row, path, matches[0]


def band_analysis(path):
    """Full actual decode; 1 s Hann spectra averaged across both channels."""
    decoded = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(path),
                                      '-ar', str(RATE), '-ac', '2', '-f', 'f32le', '-'])
    samples = np.frombuffer(decoded, dtype='<f4').reshape(-1, 2).astype(np.float64)
    frames = samples[:len(samples)//RATE*RATE].reshape(-1, RATE, 2)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(RATE)[None, :, None], axis=1)) ** 2
    frequency = np.fft.rfftfreq(RATE, 1/RATE)
    total = spectrum.sum(axis=(1, 2))
    bands = {f'{lo}-{hi}Hz': spectrum[:, (frequency >= lo) & (frequency < hi)].sum(axis=(1, 2))
             for lo, hi in [(0, 80), (80, 200), (200, 500), (500, 2000), (2000, 6000), (6000, 22050)]}
    low = bands['80-200Hz']
    index = int(np.argmax(np.convolve(low, np.ones(3)/3, mode='valid')))
    middle = np.arange(len(low))
    baseline_mask = ((middle >= 1) & (middle < 9)) | ((middle >= 22) & (middle < len(low)-1))
    baseline = float(np.median(low[baseline_mask]))
    representative = float(np.mean(low[index:index+3]))
    return {
        'method': 'Full decode to stereo float44100; consecutive 1 s Hann-window spectra, summed equally over channels. '
                  'Representative event is the largest consecutive 3 s sum of actual 80–200 Hz energy; not a human thunder annotation.',
        'wholeFileEnergyFractions': {name: float(value.sum()/max(float(total.sum()), 1e-30)) for name, value in bands.items()},
        'oneSecond80To200HzEnergyFractions': (low/np.maximum(total, 1e-30)).tolist(),
        'oneSecond80To200HzEnergyRelativeToBaselineDb': (10*np.log10(np.maximum(low/max(baseline,1e-30),1e-30))).tolist(),
        'representativeLowBandEventStartSeconds': index,
        'representativeLowBandEventEndSeconds': index+3,
        'representativeEvent80To200HzFraction': float(low[index:index+3].sum()/total[index:index+3].sum()),
        'representativeEvent80To200HzEnergyAboveBaselineDb': float(10*np.log10(representative/max(baseline,1e-30))),
        'representativeEventAbove2kHzFraction': float((bands['2000-6000Hz'][index:index+3].sum()+bands['6000-22050Hz'][index:index+3].sum())/total[index:index+3].sum()),
        'baselineWindows': '1–9 s and 22 s through the penultimate whole second; excludes the placed 10–19 s thunder events.',
        'scope': 'Objective signal evidence only; no human listening or semantic source certification.'
    }


def encode_pair(identifier, processed, duration, kind, helper, tools):
    working = ASSETS / f'{identifier}.working.wav'
    mobile_working = ASSETS / f'{identifier}-mobile.working.wav'
    target, ceiling = (-28.5, -4) if kind == 'rain' else (-34, -8)
    try:
        run('-i', processed, '-af', f'afade=t=in:st=0:d=0.005,afade=t=out:st={duration-.005}:d=0.005',
            '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', working)
        browser = helper.encode(working, ASSETS / f'{identifier}.mp3', duration, tools,
                                channels=2, bitrate=192, target_rms=target, peak_ceiling=ceiling)
        run('-ss', 6, '-i', processed, '-t', 18,
            '-af', 'afade=t=in:st=0:d=0.005,afade=t=out:st=17.995:d=0.005',
            '-ar', RATE, '-ac', 1, '-c:a', 'pcm_f32le', mobile_working)
        mobile = helper.encode(mobile_working, ASSETS / f'{identifier}-mobile.mp3', 18, tools,
                               channels=1, bitrate=96, target_rms=target, peak_ceiling=ceiling)
    finally:
        working.unlink(missing_ok=True)
        mobile_working.unlink(missing_ok=True)
    mobile.update({'assetKind': 'mobile-derivative-of-genuine-model-output',
                   'sourceExcerptStartSeconds': 6, 'sourceExcerptEndSeconds': 24,
                   'processing': 'Direct processed float seconds 6–24, mono downmix, 5 ms boundary guards, '
                                 'fixed gain and one44.1kHz96kbps MP3 encode; no MP3-to-MP3 transcode.'})
    return browser, mobile


def finish_storm(identifier, spec, batches, helper, tools):
    bed, bed_path, bed_batch = proof(spec['bed'], batches, tools)
    thunder, thunder_path, thunder_batch = proof(spec['thunder'], batches, tools)
    duration = bed['durationSeconds']
    event = ASSETS / f'{identifier}-thunder-event.wav'
    processed = ASSETS / f'{identifier}-processed-master.wav'
    # Retain the genuine event, remove subsonic weight and high cracks, and
    # give its existing deep rolling body a broad fixed 120 Hz lift.
    event_filters = ('highpass=f=35:p=2,lowpass=f=1400:p=2,'
                     'equalizer=f=120:t=o:w=1.5:g=4,'
                     f'afade=t=in:st=0:d=0.8,afade=t=out:st={spec["thunderSourceDuration"]-2}:d=2')
    run('-ss', spec['thunderSourceStart'], '-i', thunder_path, '-t', spec['thunderSourceDuration'],
        '-af', event_filters, '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', event)
    bed_metrics, event_metrics = tools.audio_metrics(bed_path), tools.audio_metrics(event)
    bed_gain = spec['bedTargetRms'] - bed_metrics['rmsDbfs']
    event_gain = spec['thunderTargetRms'] - event_metrics['rmsDbfs']
    delay_ms = round(spec['thunderOutputStart']*1000)
    graph = (f'[0:a]volume={bed_gain:.9f}dB[bed];'
             f'[1:a]volume={event_gain:.9f}dB,adelay={delay_ms}|{delay_ms}[thunder];'
             '[bed][thunder]amix=inputs=2:duration=first:normalize=0[out]')
    run('-i', bed_path, '-i', event, '-filter_complex', graph, '-map', '[out]',
        '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', processed)
    browser, mobile = encode_pair(identifier, processed, duration, 'rain', helper, tools)
    source = {
        'id': identifier, 'kind': 'rain', 'title': spec['title'], 'description': spec['description'],
        **{key: bed[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
        'generated': True, 'rawModelOutput': False, 'assetKind': 'processed-blend-of-genuine-model-outputs',
        'sourceGenerations': [bed, thunder], 'generationIds': [spec['bed'], spec['thunder']],
        'generationBatchRecord': bed_batch, 'additionalGenerationBatchRecords': [thunder_batch],
        'verifiedWeights': batches[bed_batch]['verifiedWeights'], 'device': batches[bed_batch]['device'],
        'rawGeneratedMasters': [bed['master'], thunder['master']],
        'rawMasterValidation': {spec['bed']: bed_metrics, spec['thunder']: tools.audio_metrics(thunder_path)},
        'processedMaster': {'file': processed.name, 'bytes': processed.stat().st_size, 'sha256': tools.sha256(processed)},
        'retainedThunderEvent': {'file': event.name, 'bytes': event.stat().st_size, 'sha256': tools.sha256(event),
                                'filters': event_filters, 'validation': event_metrics},
        'sourceExcerpts': [{'generationId': spec['bed'], 'startSeconds': 0, 'endSeconds': duration,
                            'outputStartSeconds': 0, 'fixedGainDb': bed_gain, 'filters': 'none'},
                           {'generationId': spec['thunder'], 'startSeconds': spec['thunderSourceStart'],
                            'endSeconds': spec['thunderSourceStart']+spec['thunderSourceDuration'],
                            'outputStartSeconds': spec['thunderOutputStart'],
                            'outputEndSeconds': spec['thunderOutputStart']+spec['thunderSourceDuration'],
                            'fixedGainDb': event_gain, 'filters': event_filters}],
        'processing': f'Use the entire unchanged genuine {duration}s heavy-rain bed at fixed {bed_gain:.9f}dB gain, '
                      f'without rain filtering, compression, AGC, limiting, gating or envelope riding. '
                      f'Use actual generated thunder {spec["thunderSourceStart"]}–'
                      f'{spec["thunderSourceStart"]+spec["thunderSourceDuration"]}s from the separate genuine storm take; '
                      '35Hz two-pole high-pass,1400Hz two-pole low-pass, broad +4dB120Hz/1.5-octave EQ, '
                      f'800ms event fade-in and2s fade-out, fixed {event_gain:.9f}dB gain. '
                      f'Place that real excerpt at output {spec["thunderOutputStart"]}–'
                      f'{spec["thunderOutputStart"]+spec["thunderSourceDuration"]}s and sum without automatic mix normalization. '
                      'This midpoint placement is an explicit edit, not model time-following. '
                      'Main MP3:30s stereo44100Hz192kbps,5ms boundary guards, fixed level constrained to-4dBFS encoded peak. '
                      'Mobile:direct processed float6–24s,mono44100Hz96kbps. Original generated float masters retained unchanged. '
                      'No external audio, synthesized noise, duplicated-offset copies, speed/pitch changes, reverb or echo effects.',
        'browserAsset': browser, 'mobile': mobile, 'validation': browser['validation'],
        'thunderBandAnalysis': band_analysis(ASSETS/browser['file']),
        'rawThunderBandAnalysis': band_analysis(thunder_path),
        'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
        'sourceMasterUnchangedChecks': {spec['bed']: tools.sha256(bed_path)==bed['master']['sha256'],
                                      spec['thunder']: tools.sha256(thunder_path)==thunder['master']['sha256']},
        'listeningReview': 'Signal/provenance measurements only. No human listening review, source identity guarantee, '
                           'or semantic certification of no voices/music is claimed.',
        'completedAt': now(),
    }
    helper.save(ASSETS/f'{identifier}-source.json', source)
    return helper.catalog_row(source, browser, mobile), source


def finish_haze(identifier, batches, helper, tools):
    generation, raw, batch_name = proof(identifier, batches, tools)
    processed = ASSETS/f'{identifier}-processed-master.wav'
    filters = 'highpass=f=280:p=2'
    run('-i', raw, '-af', filters, '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', processed)
    browser, mobile = encode_pair(identifier, processed, generation['durationSeconds'], 'haze', helper, tools)
    source = {
        'id': identifier, 'kind': 'haze', 'title': generation['title'], 'description': generation['role'],
        **{key: generation[key] for key in ('model', 'modelUrl', 'sourceUrl', 'license', 'licenseUrl')},
        'generated': True, 'rawModelOutput': False, 'assetKind': 'processed-derivative-of-genuine-model-output',
        'generationId': identifier, 'sourceGeneration': generation,
        'generationBatchRecord': batch_name, 'verifiedWeights': batches[batch_name]['verifiedWeights'],
        'device': batches[batch_name]['device'], 'rawGeneratedMaster': generation['master'],
        'rawMasterValidation': tools.audio_metrics(raw),
        'processedMaster': {'file': processed.name, 'bytes': processed.stat().st_size, 'sha256': tools.sha256(processed)},
        'derivation': {'source': raw.name, 'filters': filters},
        'processing': '280Hz two-pole high-pass removes low weight; full fine upper bandwidth retained. '
                      'No compression, low-pass, lo-fi, added noise, repeated copies, pitch/speed changes, delay or reverb. '
                      'Quieter fixed level toward-34dBFS RMS constrained to-8dBFS encoded peak; 5ms boundary guards. '
                      'Main:30s stereo44100Hz192kbps. Mobile:direct processed float6–24s,mono44100Hz96kbps. '
                      'Both independently encoded from float. Genuine original stereo float master retained unchanged.',
        'browserAsset': browser, 'mobile': mobile, 'validation': browser['validation'],
        'bandAnalysis': band_analysis(ASSETS/browser['file']),
        'playbackBoundary': {'fadeInSeconds': .005, 'fadeOutSeconds': .005, 'loopConditioning': 'runtime-circular-overlap'},
        'sourceMasterUnchangedCheck': tools.sha256(raw)==generation['master']['sha256'],
        'listeningReview': 'Signal measurements only; no human listening or semantic source certification.',
        'completedAt': now(),
    }
    helper.save(ASSETS/f'{identifier}-source.json', source)
    return helper.catalog_row(source, browser, mobile), source


def main():
    helper, tools = helpers()
    batches = {name: json.loads((ASSETS/name).read_text()) for name in BATCH_NAMES}
    if any(batch['status']!='complete' for batch in batches.values()):
        raise ValueError('Both genuine local batches must complete')
    manifest_path = ASSETS/'manifest.json'
    previous = json.loads(manifest_path.read_text())
    # Preserve all old asset bytes, metadata, phone selections, and source masters.
    old_assets = {row['id']: row for row in previous['assets'] if row['id'] not in NEW_IDS}
    old_hashes = {identifier: tools.sha256(ROOT/row['file']) for identifier, row in old_assets.items()}
    if any(old_hashes[identifier]!=row['sha256'] for identifier,row in old_assets.items()):
        raise ValueError('A retained published asset does not match its provenance hash')
    rows, sources = [], {}
    for identifier, spec in STORMS.items():
        row, source = finish_storm(identifier, spec, batches, helper, tools)
        rows.append(row); sources[identifier]=source
    for identifier in ['haze-air-v23', 'haze-float-v23']:
        row, source = finish_haze(identifier, batches, helper, tools)
        rows.append(row); sources[identifier]=source
    manifest = json.loads(json.dumps(previous))
    manifest['assets'] = list(old_assets.values())+rows
    manifest['version'] = 12
    manifest['morphs']['rain'] = ['rain-natural-light', 'rain-storm-v23']
    manifest['morphs']['haze'] = ['haze-air-v23', 'haze-float-v23']
    manifest['rainAlternatives'] = ['rain-natural-light', 'rain-natural-steady', 'rain-storm-v23', 'rain-storm-v23-study2']
    manifest['residueVariations']['haze'] = list(dict.fromkeys(previous['residueVariations']['haze']+['haze-air-v23','haze-float-v23']))
    if len(manifest['assets'])>40 or manifest['phone']!=previous['phone']:
        raise ValueError('Catalog capacity or preserved phone selection invariant failed')
    retained_checks = {identifier: tools.sha256(ROOT/row['file'])==old_hashes[identifier]
                       for identifier,row in old_assets.items()}
    if not all(retained_checks.values()):
        raise ValueError('A retained published asset changed')
    validation = {
        'status': 'complete', 'completedAt': now(), 'catalogRevision': 12,
        'activeAssetCount': len(manifest['assets']), 'newIds': NEW_IDS,
        'generationBatches': BATCH_NAMES, 'genuineIndependentGenerationCount': sum(len(b['assets']) for b in batches.values()),
        'model': batches[BATCH_NAMES[0]]['model'], 'backend': batches[BATCH_NAMES[0]]['backend'],
        'morphs': {'rain': manifest['morphs']['rain'], 'haze': manifest['morphs']['haze']},
        'retainedRainReference': {'id': 'rain-natural-steady',
                                  'bandAnalysis': band_analysis(ROOT/old_assets['rain-natural-steady']['file'])},
        'phoneSelectionsUnchanged': manifest['phone']==previous['phone'], 'retainedPublishedAssetHashChecks': retained_checks,
        'retainedPublishedAssetMetadataUnchanged': all(old_assets[k]==next(r for r in manifest['assets'] if r['id']==k) for k in old_assets),
        'assets': {identifier: {'browser': s['browserAsset'], 'mobile': s['mobile'],
                               'bandAnalysis': s.get('thunderBandAnalysis',s.get('bandAnalysis')),
                               'sourceMasterUnchangedChecks': s.get('sourceMasterUnchangedChecks',s.get('sourceMasterUnchangedCheck'))}
                   for identifier,s in sources.items()},
        'editorialTiming': 'The model did not put its largest bass event exactly halfway. Actual generated thunder excerpts '
                           'are explicitly placed at10–18s and10–19s in the new30s rain derivatives, with exact source ranges '
                           'and fixed gains documented. No claim of generated time control.',
        'scope': 'Full decode, finite samples, exact expected lengths, conservative peaks, spectral bands and hash provenance '
                 'are verified. No human listening or semantic certification is claimed.'
    }
    helper.save(ASSETS/'storm-haze-v23-validation.json', validation)
    helper.save(manifest_path, manifest)
    print(json.dumps({'version':12,'activeAssets':len(manifest['assets']),'newIds':NEW_IDS,
                      'assets':{identifier:{'rms':s['validation']['rmsDbfs'],'peak':s['validation']['peakDbfs'],
                                            'bands':s.get('thunderBandAnalysis',s.get('bandAnalysis'))}
                                for identifier,s in sources.items()}},indent=2))


if __name__=='__main__':
    main()
