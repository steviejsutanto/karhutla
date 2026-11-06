#!/usr/bin/env python3
"""Prepare one coherent slow phone cricket loop from a newly generated master.

No catalog writes. The integration JSON is merged by the catalog coordinator.
All old recordings and both new raw generated masters remain unchanged.
"""
from pathlib import Path
from datetime import datetime, timezone
import json,hashlib,subprocess
import numpy as np
import soundfile as sf
from scipy.signal import butter,sosfiltfilt,resample_poly,resample,find_peaks
ROOT=Path(__file__).resolve().parent.parent
ASSETS=ROOT/'audio-assets/v3';RATE=32000;IDENT='cricket-steady-phone-v34';SOURCE=IDENT+'-take2'
PLAYBACK=.76;PERIOD=.912;COUNT=16;OVERLAP=.025;PITCH=2**(-4/12)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def decode(p):return np.frombuffer(subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(p),'-ar',str(RATE),'-ac','1','-f','f32le','-']),dtype='<f4').astype(float)
def envelope(x):
 hop=round(.001*RATE);n=len(x)//hop
 return np.sqrt(np.mean(x[:n*hop].reshape(n,hop)**2,axis=1))
def validate(x):
 env=envelope(x);peaks,_=find_peaks(env,distance=round(.6*1000),prominence=env.max()*.15,height=env.max()*.2)
 centers=peaks/1000;intervals=np.diff(centers)
 return {'durationSeconds':len(x)/RATE,'samplesPerChannel':len(x),'nonFiniteSamples':int(np.sum(~np.isfinite(x))),
 'peakAmplitude':float(np.max(np.abs(x))),'rms':float(np.sqrt(np.mean(x*x))),'noteCount':len(peaks),
 'detectedPeakSeconds':centers.tolist(),'medianAssetIntervalSeconds':float(np.median(intervals)),
 'minimumAssetIntervalSeconds':float(np.min(intervals)),'maximumAssetIntervalSeconds':float(np.max(intervals)),
 'intervalCoefficientOfVariation':float(np.std(intervals)/np.mean(intervals)),
 'runtimeMedianIntervalSeconds':float(np.median(intervals)/PLAYBACK),'runtimePlaybackRate':PLAYBACK,
 'validationScope':'Complete decoded signal, regular timing and spectral budget only. Perceived insect timbre requires audition.'}
def main():
 generation=json.loads((ASSETS/(SOURCE+'-generation.json')).read_text());master=ASSETS/(SOURCE+'-master.wav')
 before=digest(master)
 if before!=generation['master']['sha256']:raise ValueError('Generated source hash mismatch')
 raw,sr=sf.read(master);mono=raw.mean(axis=1);x=resample_poly(mono,RATE,sr)
 filtered=sosfiltfilt(butter(3,[1200,6500],btype='bandpass',fs=RATE,output='sos'),x)
 env=envelope(filtered);peaks,_=find_peaks(env,distance=300,prominence=env.max()*.12,height=env.max()*.3)
 peaks=[int(p*RATE/1000) for p in peaks if .1<p/1000<len(x)/RATE-.1]
 if len(peaks)<COUNT:raise ValueError('Not enough distinct notes for the complete loop')
 if len(peaks)<8:raise ValueError('Not enough independent generated short cricket notes')
 # Choose distinct generated notes across the master, not one copied waveform.
 selected=np.linspace(0,len(peaks)-1,COUNT).round().astype(int)
 total=round((COUNT*PERIOD+OVERLAP)*RATE);out=np.zeros(total);events=[]
 for index,which in enumerate(selected):
  center=peaks[which];half=round(.0325*RATE);atom=filtered[center-half:center+half].copy()
  atom=resample(atom,round(len(atom)/PITCH));atom=sosfiltfilt(butter(3,[800,3800],btype='bandpass',fs=RATE,output='sos'),atom)
  fade=min(round(.006*RATE),len(atom)//4);edge=.5-.5*np.cos(np.linspace(0,np.pi,fade));atom[:fade]*=edge;atom[-fade:]*=edge[::-1]
  atom*=min(.13/max(np.sqrt(np.mean(atom*atom)),1e-9),.45/max(np.max(np.abs(atom)),1e-9))
  jitter=[0,.002,-.002,.001,-.001,.003,-.003,.001,0,-.002,.002,-.001,.001,-.003,.003,0][index]
  target=OVERLAP+.25+index*PERIOD+jitter;at=round(target*RATE)-len(atom)//2
  gain=10**([0,.15,-.1,.1,-.15,.05,-.05,.1,0,-.1,.15,-.05,.05,-.15,.1,0][index]/20)
  out[at:at+len(atom)]+=atom*gain
  events.append({'sourceMaster':master.name,'sourceCenterSeconds':center/RATE,'sourceWindowSeconds':.065,
   'assetCenterSeconds':target,'noteSeconds':len(atom)/RATE,'runtimeWindowSeconds':len(atom)/RATE/PLAYBACK,
   'jitterSeconds':jitter,'gainDb':20*np.log10(gain)})
 # One fixed output trim; runtime's normal recording preparation remains visible.
 out*=min(.035/max(np.sqrt(np.mean(out*out)),1e-9),.6/max(np.max(np.abs(out)),1e-9))
 processed=ASSETS/(IDENT+'-processed-master.wav');sf.write(processed,out,RATE,subtype='FLOAT')
 mp3=ASSETS/(IDENT+'.mp3');subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(processed),'-map_metadata','-1','-c:a','libmp3lame','-b:a','96k',str(mp3)],check=True)
 encoded=decode(mp3);validation=validate(encoded)
 if validation['noteCount']!=COUNT or validation['nonFiniteSamples'] or validation['intervalCoefficientOfVariation']>.025:raise ValueError('Rhythm validation failed')
 if digest(master)!=before:raise ValueError('Generated master changed')
 processing='Select16 independent65ms waveform windows from the new take2 generated cricket master; transpose each note down4semitones offline, filter800–3800Hz,6ms cosine edges, place on a single912ms grid with at most3ms deterministic jitter and0.15dB note-level variation. Add25ms of quiet loop-overlap allowance so existing native cricket crossfade preserves the16-beat loop period. Mono32kHz96kbpsMP3. Runtime playback remains0.76:1200ms inter-note interval, approximately108ms complete note windows; no further rhythmic stretching, overlapping layers, external recordings or synthesized oscillators.'
 row={'id':IDENT,'title':'Steady solitary phone cricket','kind':'crickets','file':'audio-assets/v3/'+mp3.name,'bytes':mp3.stat().st_size,'sha256':digest(mp3),
 'durationSeconds':len(encoded)/RATE,'sampleRate':RATE,'channels':1,'bitrateKbps':96,'generated':True,'fieldRecording':False,
 'assetKind':'periodic-mobile-bed-of-new-generated-insect-note-excerpts','model':generation['model'],'modelUrl':generation['modelUrl'],
 'sourceUrl':generation['sourceUrl'],'license':generation['license'],'licenseUrl':generation['licenseUrl'],'processing':processing,
 'provenanceFile':'audio-assets/v3/'+IDENT+'-source.json'}
 provenance={**row,'generationBatchRecord':'audio-assets/v3/medium-backgrounds-v34-batch.json','sourceGeneration':generation,'sourceMaster':{'file':master.name,'sha256':before},
 'sourceMasterUnchanged':True,'processedMaster':{'file':processed.name,'sha256':digest(processed)},'preparedNotePitchSemitones':-4,'runtimePlaybackRate':PLAYBACK,
 'nominalAssetIntervalSeconds':PERIOD,'nominalRuntimeIntervalSeconds':PERIOD/PLAYBACK,'nativeCrossfadeAllowanceSeconds':OVERLAP,'nativePreparedLoopSeconds':COUNT*PERIOD,
 'events':events,'validation':validation,'completedAt':datetime.now(timezone.utc).isoformat(),
 'listeningReview':'A new synthetic creative interpretation of a solitary cricket. Signal/timing checks are not an authenticity or perceptual-species certification.'}
 save(ASSETS/(IDENT+'-source.json'),provenance)
 integration={'assets':[row],'phone':{'crickets':IDENT,'cricketLayers':[]},'preserveMainCricketLayers':True,'provenanceFile':row['provenanceFile'],'validation':validation}
 save(ASSETS/(IDENT+'-integration.json'),integration);print(json.dumps(integration,indent=2))
if __name__=='__main__':main()
