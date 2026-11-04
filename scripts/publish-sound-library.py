#!/usr/bin/env python3
"""Build the local listening-room catalog from verified generated and CC0 audio."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'audio-assets' / 'v3'
NAMES = {
    'fire-dry-brush': ('forest', 'Dry brush'),
    'fire-wind-flames': ('forest', 'Wind through flames'),
    'fire-ground-embers': ('forest', 'Ground embers'),
    'phone-branches-leaves': ('phone-crackle', 'Branches and leaves'),
}
DESCRIPTIONS = {
    'fire-dry-brush': 'A warm burning rush with busy, rounded papery grain.',
    'fire-wind-flames': 'Wind-driven flame rush with a muted layer of fine crackle.',
    'fire-ground-embers': 'A closer, darker bed of ember grain and softly breathing fire.',
    'phone-branches-leaves': 'Fine burning branches and dry leaves, with papery rustle and small woody crackles.',
    'haze-light': 'A thin, delicate air whisper with fine leaf movement.',
    'haze-drift': 'More drifting air and leaf flutter, with the low rumble removed.',
    'ash-fine': 'Clear fine sifting and delicate papery scattering, with full-bandwidth detail.',
    'ash-scatter': 'Fuller dry scattering and papery flutter, with full-bandwidth detail.',
    'rain-light': 'Fine small droplets and a gentle leafy patter.',
    'rain-steady': 'A fuller steady water layer with softened isolated drops.',
    'moisture-seep': 'Subtle close water movement through damp soil and moss.',
    'moisture-trickle': 'A gentle shallow trickle with softened water onsets.',
    'crickets-pulse': 'Repeated close cricket calls, with low background rumble removed.',
    'crickets-chorus': 'An alternative repeated cricket pattern, with low background rumble removed.',
}
PALETTE = json.loads((ROOT / 'scripts/stablegen-v4-palette-prompts.json').read_text())['assets']
for preset in PALETTE:
    NAMES[preset['id']] = (preset['kind'], preset['title'])

MORPHS = {
    'forest': ['fire-ground-embers', 'fire-wind-flames'],
    'haze': ['haze-light', 'haze-drift'],
    'ash': ['ash-fine', 'ash-scatter'],
    'rain': ['rain-natural-light', 'rain-natural-steady'],
    'moisture': ['moisture-seep', 'moisture-trickle'],
}
ARCHIVED_IDS = ['haze', 'ash', 'rain', 'moisture', 'crickets']
PHONE_CRACKLE_ID = 'phone-branches-leaves'
NATURAL_PACK = json.loads((ROOT / 'scripts/natural-assets-v6.json').read_text())
CRICKET_LAYERS = ['cricket-near', 'cricket-mid', 'cricket-far']

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    assets, held = [], []
    for identifier, (kind, title) in NAMES.items():
        provenance = ASSETS / f'{identifier}-source.json'
        if not provenance.exists():
            continue
        source = json.loads(provenance.read_text())
        proof = source.get('sourceGeneration', source)
        if source.get('status') != 'generated' or proof.get('generated') is not True or proof.get('status') != 'generated' or proof.get('seed') != source.get('seed') or proof.get('prompt') != source.get('prompt'):
            raise ValueError(f'Generation is not complete: {identifier}')
        if source.get('model') != 'Stable Audio 3 Medium':
            raise ValueError(f'This batch requires the verified larger model: {identifier}')
        audio = ASSETS / f'{identifier}.mp3'
        exported = source.get('browserAsset', source)
        if audio.stat().st_size != exported['bytes'] or digest(audio) != exported['sha256']:
            raise ValueError(f'Browser audio differs from its provenance: {identifier}')
        master = source.get('wavMaster', source.get('master'))
        if not master or digest(ASSETS / master['file']) != master['sha256']:
            raise ValueError(f'Master differs from its provenance: {identifier}')
        if source.get('sourceGeneration'):
            raw = proof['master']
            if digest(ASSETS / raw['file']) != raw['sha256']:
                raise ValueError(f'Raw generated source differs from its provenance: {identifier}')
        signal = source.get('validation', {})
        mobile = source.get('mobile')
        if mobile:
            mobile_path = ROOT / mobile['file']
            if mobile_path.parent != ASSETS or mobile_path.stat().st_size != mobile['bytes'] or digest(mobile_path) != mobile['sha256']:
                raise ValueError(f'Mobile audio differs from its provenance: {identifier}')
        high_band = signal.get('spectralEnergyAbove6kHz', signal.get('spectralEnergyFractions', {}).get('6000-22050Hz', 0))
        if kind in ['forest', 'ash', 'phone-crackle'] and signal.get('windowRmsMaxAboveMedianDb', 0) > 16 and high_band > .1:
            held.append({'id': identifier, 'reason': 'Sparse bright transients conflict with the requested softer continuous direction.'})
            continue
        asset = {
            'id': identifier, 'kind': kind, 'title': title,
            'description': DESCRIPTIONS[identifier],
            'file': str(audio.relative_to(ROOT)), 'model': source['model'],
            'durationSeconds': source['durationSeconds'], 'bytes': exported['bytes'],
            'bitrateKbps': exported.get('bitrateKbps', 160),
            'sha256': exported['sha256'], 'sourceUrl': source['sourceUrl'],
            'modelUrl': source['modelUrl'], 'license': source['license'], 'licenseUrl': source['licenseUrl'],
            'generated': True, 'prompt': source['prompt'], 'seed': source['seed'],
            'assetKind': source.get('assetKind', 'generated-model-output'),
            'rawModelOutput': source.get('rawModelOutput', True),
            'processing': source.get('processing', ''),
            'provenanceFile': str(provenance.relative_to(ROOT)),
            'validation': source.get('validation', {}),
        }
        if 'endpoint' in source:
            asset.update({'endpoint': source['endpoint'], 'endpointPosition': source['endpointPosition']})
        if source.get('generationId'):
            asset['generationId'] = source['generationId']
        if source.get('generationBatchRecord'):
            asset['generationBatchRecord'] = source['generationBatchRecord']
        if mobile:
            asset['mobile'] = mobile
        if source.get('playbackBoundary'):
            asset['playbackBoundary'] = source['playbackBoundary']
        assets.append(asset)
    for preset in NATURAL_PACK['assets']:
        identifier = preset['id']
        provenance = ASSETS / f'{identifier}-source.json'
        source = json.loads(provenance.read_text())
        if source.get('status') != 'prepared' or source.get('generated') is not False or source.get('fieldRecording') is not True:
            raise ValueError(f'Prepared field recording required: {identifier}')
        if source.get('licenseUrl') != 'https://creativecommons.org/publicdomain/zero/1.0/':
            raise ValueError(f'Verified CC0 license required: {identifier}')
        audio = ASSETS / source['browserAsset']['file']
        exported = source['browserAsset']
        if audio.stat().st_size != exported['bytes'] or digest(audio) != exported['sha256']:
            raise ValueError(f'Field-recording export differs from provenance: {identifier}')
        for field in ['sourcePreview', 'sourcePageEvidence']:
            evidence = source[field]
            path = ROOT / evidence['file']
            if path.stat().st_size != evidence['bytes'] or digest(path) != evidence['sha256']:
                raise ValueError(f'Retained source evidence differs from provenance: {identifier}/{field}')
        asset = {
            'id': identifier, 'kind': preset['kind'], 'title': preset['title'], 'description': preset['description'],
            'file': str(audio.relative_to(ROOT)), 'durationSeconds': preset['durationSeconds'],
            'bytes': exported['bytes'], 'sha256': exported['sha256'], 'bitrateKbps': exported['bitrateKbps'],
            'channels': exported['channels'], 'sampleRate': exported['sampleRate'],
            'sourceUrl': source['sourceUrl'], 'sourceTitle': preset['sourceTitle'], 'author': preset['author'],
            'freesoundId': preset['freesoundId'], 'license': source['license'], 'licenseUrl': source['licenseUrl'],
            'generated': False, 'fieldRecording': True, 'preview': True,
            'assetKind': source['assetKind'], 'sourcePreviewUrl': source['sourcePreviewUrl'],
            'processing': source['processing'], 'provenanceFile': str(provenance.relative_to(ROOT)),
            'validation': source['validation'], 'playbackBoundary': source['playbackBoundary'],
        }
        for field in ['endpoint', 'endpointPosition', 'depth']:
            if field in preset:
                asset[field] = preset[field]
        assets.append(asset)
    published_ids = {asset['id'] for asset in assets}
    expected_ids = set(NAMES) | {preset['id'] for preset in NATURAL_PACK['assets']}
    if expected_ids - published_ids:
        raise ValueError(f'Cannot replace the active catalog before the complete revised palette is ready: {sorted(expected_ids - published_ids)}')
    referenced_ids = {identifier for pair in MORPHS.values() for identifier in pair} | {'crickets-pulse', 'crickets-chorus', PHONE_CRACKLE_ID} | set(CRICKET_LAYERS)
    if referenced_ids - published_ids or len(assets) != len(expected_ids):
        raise ValueError('Every referenced endpoint and the complete active catalog must be verified before publication')
    by_id = {asset['id']: asset for asset in assets}
    for identifier in [PHONE_CRACKLE_ID, 'crickets-pulse']:
        if not by_id[identifier].get('mobile'):
            raise ValueError(f'Verified compact mobile derivative is required before publication: {identifier}')
    result = {
        'version': 6, 'title': 'Fire, rain and a living night', 'model': 'Stable Audio 3 Medium + CC0 natural field recordings',
        'modelUrl': 'https://huggingface.co/stabilityai/stable-audio-3-medium',
        'defaultForest': 'fire-wind-flames' if any(a['id'] == 'fire-wind-flames' for a in assets) else next((a['id'] for a in assets if a['kind'] == 'forest'), None),
        'assets': assets, 'heldForReview': held,
        'morphs': MORPHS,
        'aftermath': ['crickets-pulse', 'crickets-chorus'],
        'cricketLayers': CRICKET_LAYERS,
        'phone': {'crackle': PHONE_CRACKLE_ID, 'crickets': 'crickets-pulse'},
        'archived': [
            *[{'id': identifier, 'reason': 'Earlier palette study superseded by the revised endpoint generations; files and provenance retained on disk.'} for identifier in ARCHIVED_IDS],
            {'id': 'phone-crackle', 'reason': 'Earlier close ember phone texture superseded by branches and leaves; original master, desktop/mobile files and provenance retained on disk.'},
            {'id': 'phone-branches-leaves-take1', 'reason': 'Independent unselected branch and leaf take retained for optional audition; excluded from active choices.',
             'file': 'audio-assets/v3/phone-branches-leaves-take1.mp3', 'provenanceFile': 'audio-assets/v3/phone-branches-leaves-take1-source.json'},
        ],
    }
    temporary = ASSETS / 'manifest.pending.json'
    temporary.write_text(json.dumps(result, indent=2) + '\n')
    temporary.replace(ASSETS / 'manifest.json')
    with ZipFile(ASSETS / 'wildfire-medium-assets.zip', 'w', ZIP_DEFLATED) as bundle:
        bundle.write(ASSETS / 'manifest.json', 'manifest.json')
        for asset in assets:
            bundle.write(ROOT / asset['file'], Path(asset['file']).name)
            bundle.write(ROOT / asset['provenanceFile'], Path(asset['provenanceFile']).name)
            if asset.get('mobile'):
                bundle.write(ROOT / asset['mobile']['file'], Path(asset['mobile']['file']).name)
        for extra in ['README.md', 'model-research.json', 'medium-palette-batch.json', 'medium-palette-retry-batch.json', 'medium-ash-retry-batch.json', 'medium-branches-leaves-batch.json', 'branches-leaves-finishing.json', 'branches-leaves-validation.json', 'palette-validation.json', 'natural-assets-validation.json']:
            if (ASSETS / extra).exists():
                bundle.write(ASSETS / extra, extra)
        bundle.write(ROOT / 'audio-assets/ATTRIBUTION.md', 'ATTRIBUTION.md')
        for extra in ['phone-branches-leaves-take1.mp3', 'phone-branches-leaves-take1-source.json']:
            bundle.write(ASSETS / extra, 'audition/' + extra)
        retained = set()
        for preset in NATURAL_PACK['assets']:
            source = json.loads((ASSETS / f"{preset['id']}-source.json").read_text())
            for field in ['sourcePreview', 'sourcePageEvidence']:
                path = ROOT / source[field]['file']
                if path not in retained:
                    bundle.write(path, 'natural-sources/' + path.name)
                    retained.add(path)
        bundle.write(ROOT / 'scripts/natural-assets-v6.json', 'natural-assets-v6.json')
    print(json.dumps({'published': len(assets), 'defaultForest': result['defaultForest']}))

if __name__ == '__main__':
    main()
