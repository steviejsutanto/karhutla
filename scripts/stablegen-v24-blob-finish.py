#!/usr/bin/env python3
"""Publish four distinct short liquid blob excerpts from genuine MLX masters.

The unchanged model outputs, exact event ranges, processing and hashes are
retained. Each browser one-shot uses only filtering, short fades, mono
downmix and fixed gain. No inference, substitute synthesis, pitch/speed
changes, repeated-copy layering or dynamic normalization occurs here.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets/v3'
BATCH_NAME = 'medium-blob-v24-batch.json'
RATE = 44100
SELECTIONS = {
    'extinction-blob-a': {'startSeconds': 0, 'durationSeconds': .72},
    'extinction-blob-b': {'startSeconds': .08, 'durationSeconds': .65},
    'extinction-blob-c': {'startSeconds': 0, 'durationSeconds': .70},
    'extinction-blob-d': {'startSeconds': .66, 'durationSeconds': .60},
}
FILTERS = 'highpass=f=90:p=2,lowpass=f=2600:p=2,equalizer=f=450:t=o:w=1.5:g=2'


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(path)


def run(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)], check=True)


def decode(path):
    result = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(path),
                                      '-ar', str(RATE), '-ac', '1', '-f', 'f32le', '-'])
    return np.frombuffer(result, dtype='<f4').astype(np.float64)


def metrics(path):
    """Short-clip metrics; whole-clip FFT handles events shorter than1s."""
    samples = decode(path)
    if not len(samples):
        raise ValueError(f'Empty decode: {path}')
    finite = np.isfinite(samples)
    x = np.nan_to_num(samples)
    db = lambda n: float(20*np.log10(max(float(n), 1e-12)))
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x*x)))
    win = 441
    windows = x[:len(x)//win*win].reshape(-1, win)
    energies = np.sqrt(np.mean(windows*windows, axis=1))
    spectrum = np.abs(np.fft.rfft(x*np.hanning(len(x))))**2
    frequency = np.fft.rfftfreq(len(x), 1/RATE)
    total = max(float(spectrum.sum()),1e-30)
    bands = {f'{lo}-{hi}Hz': float(spectrum[(frequency>=lo)&(frequency<hi)].sum()/total)
             for lo,hi in [(0,120),(120,500),(500,2000),(2000,6000),(6000,22050)]}
    return {
        'completeDecode': 'passed', 'samplesPerChannel': len(x), 'nonFiniteSamples': int((~finite).sum()),
        'peakAmplitude': peak, 'peakDbfs': db(peak), 'rmsDbfs': db(rms), 'crestDb': db(peak)-db(rms),
        'nearFullScaleSampleFraction': float(np.mean(np.abs(x)>=.999)),
        'spectralEnergyFractions': bands,
        'spectralMethod': 'Whole short clip mono float decode with a Hann window; energy fractions from its full-length FFT.',
        'peak10msWindowStartSeconds': int(np.argmax(energies))*.01,
        'quietWindowFractionBelowMinus65Dbfs': float(np.mean(energies<10**(-65/20))),
        'scope': 'Signal and short-event envelope measurements only; not a human listening or semantic source certification.',
    }


def proof(identifier, batch):
    generation = json.loads((ASSETS/f'{identifier}-generation.json').read_text())
    raw = ASSETS/generation['master']['file']
    if (batch['status']!='complete' or generation.get('generated') is not True
            or generation.get('status')!='generated'
            or batch['assets'].get(identifier,{}).get('master',{}).get('sha256')!=generation['master']['sha256']
            or sha256(raw)!=generation['master']['sha256']):
        raise ValueError(f'Completed generation and unchanged matching raw master required: {identifier}')
    return generation,raw


def finish(identifier, selection, batch):
    generation,raw = proof(identifier,batch)
    start = selection['startSeconds']
    duration = selection['durationSeconds']
    start_sample = round(start*RATE)
    length_samples = round(duration*RATE)
    processed = ASSETS/f'{identifier}-processed-master.wav'
    output = ASSETS/f'{identifier}.mp3'
    filter_chain = (f'atrim=start_sample={start_sample}:end_sample={start_sample+length_samples},asetpts=PTS-STARTPTS,'
                    f'{FILTERS},afade=t=in:st=0:d=0.012,afade=t=out:st={duration-.18:.6f}:d=0.18')
    run('-i',raw,'-af',filter_chain,'-ar',RATE,'-ac',1,'-c:a','pcm_f32le',processed)
    processed_metrics = metrics(processed)
    if processed_metrics['nonFiniteSamples'] or processed_metrics['samplesPerChannel']!=length_samples:
        raise ValueError(f'Invalid processed one-shot: {identifier}')
    target_rms = -27
    ceiling = -11
    gain = min(target_rms-processed_metrics['rmsDbfs'],ceiling-1-processed_metrics['peakDbfs'])
    correction = 0
    for _ in range(4):
        run('-i',processed,'-af',f'volume={gain:.9f}dB','-ar',RATE,'-ac',1,'-map_metadata','-1',
            '-c:a','libmp3lame','-b:a','96k',output)
        published_metrics = metrics(output)
        if published_metrics['nonFiniteSamples'] or published_metrics['samplesPerChannel']!=length_samples:
            raise ValueError(f'Incomplete or nonfinite browser one-shot: {identifier}')
        if published_metrics['peakDbfs']<=ceiling:
            break
        adjustment = published_metrics['peakDbfs']-ceiling+.3
        gain-=adjustment; correction+=adjustment
    else:
        raise ValueError(f'Encoded peak check failed: {identifier}')
    browser = {
        'file': output.name, 'bytes': output.stat().st_size, 'sha256': sha256(output),
        'durationSeconds': duration, 'sampleRate': RATE, 'channels': 1, 'bitrateKbps':96,
        'normalization': {'targetRmsDbfs':target_rms,'peakCeilingDbfs':ceiling,'appliedGainDb':gain,
                          'codecHeadroomCorrectionDb':correction},
        'validation': {**published_metrics,'encodedPeakCeilingDbfs':ceiling,'encodedPeakCheck':'passed'},
    }
    source = {
        'id': identifier, 'kind': 'blob', 'title': generation['title'], 'description': generation['role'],
        **{key:generation[key] for key in ('model','modelUrl','sourceUrl','license','licenseUrl')},
        'generated': True,'assetKind':'processed-excerpt-of-genuine-model-output','rawModelOutput':False,
        'generationId': identifier,'sourceGeneration':generation,'generationBatchRecord':BATCH_NAME,
        'verifiedWeights':batch['verifiedWeights'],'device':batch['device'],
        'rawGeneratedMaster':generation['master'],'rawMasterValidation':metrics(raw),
        'sourceExcerptStartSeconds':start,'sourceExcerptEndSeconds':start+duration,
        'sourceExcerptStartSample':start_sample,'sourceExcerptSampleCount':length_samples,
        'eventSelection': 'A separate real event from each of four independently generated5s masters. '
                          'Measured10ms RMS onsets/envelopes informed the excerpt; no human listening classification claimed.',
        'processedMaster': {'file':processed.name,'bytes':processed.stat().st_size,'sha256':sha256(processed),
                            'validation':processed_metrics},
        'derivation': {'source':raw.name,'filters':filter_chain},
        'processing': f'Select exact original float samples{start_sample}–{start_sample+length_samples} '
                      f'({start}–{start+duration}s) from this independent genuine master. '
                      '90Hz two-pole high-pass,2600Hz two-pole low-pass,broad+2dB450Hz/1.5-octave EQ; '
                      '12ms onset click guard and180ms ending taper,mono downmix. '
                      f'Apply fixed{gain:.9f}dB gain toward-27dBFS RMS constrained to-11dBFS decoded peak; '
                      'encode once directly from processed float as mono44100Hz96kbps MP3. '
                      'Any codec overshoot correction re-encodes directly from float. Unchanged raw master retained. '
                      'No compression,AGC,limiting,gating,external audio,substitute synthesis,repeated copies, '
                      'time/pitch changes,reverb,echo or added quench layer.',
        'browserAsset':browser,'mobile':browser,'validation':browser['validation'],
        'playbackBoundary':{'oneShot':True,'fadeInSeconds':.012,'fadeOutSeconds':.18},
        'sourceMasterUnchangedCheck':sha256(raw)==generation['master']['sha256'],
        'listeningReview':'Technical signal/provenance checks only. No human listening or semantic guarantee of liquid identity or absence of music/voices.',
        'completedAt':now(),
    }
    save(ASSETS/f'{identifier}-source.json',source)
    row = {key:source[key] for key in ('id','kind','title','description','model','sourceUrl','modelUrl','license',
                                     'licenseUrl','generated','assetKind','rawModelOutput','processing')}
    row.update({key:browser[key] for key in ('durationSeconds','bytes','bitrateKbps','sha256','validation')})
    row.update({'file':'audio-assets/v3/'+output.name,'provenanceFile':f'audio-assets/v3/{identifier}-source.json',
                'generationBatchRecord':BATCH_NAME,'generationId':identifier,
                'mobile':{**browser,'file':'audio-assets/v3/'+output.name},'playbackBoundary':source['playbackBoundary']})
    return row,source


def main():
    batch = json.loads((ASSETS/BATCH_NAME).read_text())
    if batch['status']!='complete' or len(batch['assets'])!=4:
        raise ValueError('All four independent local generations must complete first')
    manifest_path = ASSETS/'manifest.json'
    previous = json.loads(manifest_path.read_text())
    old_rows = {row['id']:row for row in previous['assets'] if row['id'] not in SELECTIONS}
    if any(sha256(ROOT/row['file'])!=row['sha256'] for row in old_rows.values()):
        raise ValueError('A retained browser asset does not match its provenance hash')
    results,sources = [],{}
    for identifier,selection in SELECTIONS.items():
        row,source = finish(identifier,selection,batch)
        results.append(row);sources[identifier]=source
    manifest = json.loads(json.dumps(previous))
    manifest['version'] = 13
    manifest['assets'] = list(old_rows.values())+results
    manifest.setdefault('main',{})['blob'] = list(SELECTIONS)
    if len(manifest['assets'])>40 or manifest['phone']!=previous['phone'] or manifest['morphs']!=previous['morphs']:
        raise ValueError('Capacity or retained phone/morph invariants failed')
    retained = {identifier:sha256(ROOT/row['file'])==row['sha256'] for identifier,row in old_rows.items()}
    if not all(retained.values()):
        raise ValueError('A retained browser asset changed')
    correlations = []
    waves = {identifier:decode(ASSETS/(identifier+'.mp3')) for identifier in SELECTIONS}
    for i,left in enumerate(SELECTIONS):
        for right in list(SELECTIONS)[i+1:]:
            count = min(len(waves[left]),len(waves[right]));a=waves[left][:count];b=waves[right][:count]
            a=a-a.mean();b=b-b.mean()
            correlations.append({'left':left,'right':right,'zeroLagWaveformCorrelation':float(np.dot(a,b)/max(np.linalg.norm(a)*np.linalg.norm(b),1e-30))})
    validation = {
        'status':'complete','completedAt':now(),'catalogRevision':13,'activeAssetCount':len(manifest['assets']),
        'newIds':list(SELECTIONS),'generationBatch':BATCH_NAME,'genuineIndependentGenerationCount':4,
        'model':batch['model'],'backend':batch['backend'],'mainBlobIds':manifest['main']['blob'],
        'mainOnlyRouting':'Only manifest.main.blob is added. Phone selections and all existing morphs stay unchanged.',
        'retainedPublishedAssetHashChecks':retained,
        'retainedPublishedAssetMetadataUnchanged':all(row==next(a for a in manifest['assets'] if a['id']==identifier) for identifier,row in old_rows.items()),
        'phoneSelectionsUnchanged':manifest['phone']==previous['phone'],'morphsUnchanged':manifest['morphs']==previous['morphs'],
        'waveformCorrelations':correlations,
        'correlationScope':'Mean-removed mono decoded samples at equal positions over the shorter event length; a copied-waveform diagnostic, not a perceptual diversity guarantee.',
        'assets':{identifier:{'sourceExcerptStartSeconds':s['sourceExcerptStartSeconds'],'sourceExcerptEndSeconds':s['sourceExcerptEndSeconds'],
                              'sourceMasterHashUnchanged':s['sourceMasterUnchangedCheck'],'browser':s['browserAsset']}
                  for identifier,s in sources.items()},
        'scope':'Four distinct independently inferred masters with transparent real event excerpts, fixedgain and filtering only; '
                'full finite decode, exact samplecounts and conservative encoded peaks checked. No human listening certification.'
    }
    save(ASSETS/'blob-v24-validation.json',validation)
    save(manifest_path,manifest)
    print(json.dumps({'version':13,'activeAssets':len(manifest['assets']),'mainBlobIds':manifest['main']['blob'],
                      'assets':{identifier:{'duration':s['browserAsset']['durationSeconds'],'rmsDbfs':s['validation']['rmsDbfs'],
                                            'peakDbfs':s['validation']['peakDbfs'],'bands':s['validation']['spectralEnergyFractions']}
                                for identifier,s in sources.items()}},indent=2))


if __name__=='__main__':
    main()
