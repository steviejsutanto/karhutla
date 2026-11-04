#!/usr/bin/env python3
"""Restore the three exact official pinned Medium weights in parallel chunks.

Existing prefixes and completed chunks are reused. Every range length and the
complete official SHA-256 are checked before a model file is accepted.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / '.audio-model-cache/weights'
BASE = 'https://huggingface.co/stabilityai/stable-audio-3-optimized/resolve/30cb2644da54bfa63275d1bc7f1fa67fc718680f/MLX/'
FILES = {
    't5gemma_f16.npz': (567443068, '8deb20489f36d9aec539f26c9c67321f99bc5fe300d470435ed6e76be4f16bbd'),
    'dit_medium_f16.npz': (2907300946, 'f9e5647ea3225818657d47d47ae4b34afa29c0568206ca89566c1a758944a38e'),
    'same_l_decoder_f32.npz': (1704311976, '84924be2122d3a20fce443f40b782d9cd88e8e73707476326003ac47659a2287'),
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def fetch(job):
    name, start, end, path = job
    expected = end - start + 1
    if path.exists() and path.stat().st_size == expected:
        return
    headers = path.with_suffix('.headers')
    subprocess.run(['curl', '-fLsS', '--retry', '8', '--retry-all-errors', '--retry-delay', '2', '--range', f'{start}-{end}',
                    '--dump-header', str(headers), BASE + name + f'?download=true&range_start={start}', '-o', str(path)], check=True)
    responses = re.findall(r'^HTTP/\S+\s+(\d+)', headers.read_text(), flags=re.MULTILINE)
    ranges = re.findall(r'^content-range:\s*bytes\s+(\d+)-(\d+)/(\d+)', headers.read_text(), flags=re.MULTILINE | re.IGNORECASE)
    if not responses or responses[-1] != '206' or not ranges or tuple(map(int, ranges[-1])) != (start, end, FILES[name][0]):
        raise ValueError(f'Official CDN returned the wrong Content-Range: {name} {start}-{end}')
    if path.stat().st_size != expected:
        raise ValueError(f'Wrong download range length: {name} {start}-{end}')
    headers.unlink()
    print(f'Downloaded {name}: {start}-{end}', flush=True)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    jobs, prefixes = [], {}
    chunk_size = 64 * 1024 * 1024
    for name, (size, expected_hash) in FILES.items():
        target = DEST / name
        if target.exists() and target.stat().st_size == size and digest(target) == expected_hash:
            print('Already verified', name, flush=True)
            continue
        if target.exists() and target.stat().st_size >= size:
            # A full-sized bad hash cannot be resumed as a trusted prefix.
            # Quarantine it without destroying evidence, then fetch afresh.
            rejected = DEST / (name + '.invalid-' + digest(target)[:12])
            if rejected.exists():
                raise ValueError(f'An identical invalid model is already quarantined: {rejected}')
            target.replace(rejected)
        parts = DEST / (name + '.parts')
        parts.mkdir(exist_ok=True)
        prefix = parts / 'prefix'
        if target.exists():
            target.replace(prefix)
        offset = prefix.stat().st_size if prefix.exists() else 0
        if offset > size:
            raise ValueError(f'Unexpected oversized existing model: {name}')
        prefixes[name] = prefix
        for start in range(offset, size, chunk_size):
            end = min(size, start + chunk_size) - 1
            jobs.append((name, start, end, parts / f'{start:012d}-{end:012d}'))
    with ThreadPoolExecutor(max_workers=16) as pool:
        for result in as_completed([pool.submit(fetch, job) for job in jobs]):
            result.result()
    for name, prefix in prefixes.items():
        target = DEST / name
        assembling = DEST / (name + '.assembling')
        with assembling.open('wb') as output:
            inputs = ([prefix] if prefix.exists() else []) + [j[3] for j in jobs if j[0] == name]
            for part in inputs:
                with part.open('rb') as stream:
                    for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                        output.write(block)
        if assembling.stat().st_size != FILES[name][0] or digest(assembling) != FILES[name][1]:
            raise ValueError(f'Complete official SHA-256 verification failed: {name}')
        assembling.replace(target)
        # Interrupted older layouts may have extra complete chunks at offsets
        # that the current valid prefix now covers. They are redundant once
        # the complete final model has passed its official hash.
        for part in prefix.parent.iterdir():
            part.unlink()
        prefix.parent.rmdir()
        print('Verified complete official model', name, flush=True)


if __name__ == '__main__':
    main()
