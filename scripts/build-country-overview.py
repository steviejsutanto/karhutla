#!/usr/bin/env python3
"""Build the cached display outline from the existing Natural Earth source.

Only this delivery derivative is simplified. The original country geometry,
used by the server's performance mask, remains unchanged. Default tolerance is
0.025 degrees, one tenth of the 0.25-degree performance grid. Every polygon and
hole is retained. Ring vertices are a subset of the original coordinates.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path


def segment_distance_squared(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = 0 if not length else max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length))
    return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2


def rdp(points, tolerance):
    """Iterative Ramer-Douglas-Peucker, preserving both endpoints."""
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    threshold = tolerance * tolerance
    while stack:
        first, last = stack.pop()
        distance, furthest = threshold, None
        for index in range(first + 1, last):
            candidate = segment_distance_squared(points[index], points[first], points[last])
            if candidate > distance:
                distance, furthest = candidate, index
        if furthest is not None:
            keep.add(furthest)
            stack.extend([(first, furthest), (furthest, last)])
    return [points[index] for index in sorted(keep)]


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def proper_intersection(a, b, c, d):
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0


def self_intersects(ring):
    segments = list(zip(ring, ring[1:]))
    for index, (a, b) in enumerate(segments):
        for other in range(index + 2, len(segments)):
            if index == 0 and other == len(segments) - 1:
                continue
            c, d = segments[other]
            if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]):
                continue
            if max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]):
                continue
            if proper_intersection(a, b, c, d):
                return True
    return False


def simplify_ring(original, tolerance):
    unique = []
    for point in original[:-1]:
        if not unique or point != unique[-1]:
            unique.append(point)
    # Tiny islands keep their exact original outlines.
    if len(unique) <= 12:
        return original
    first = unique[0]
    split = max(range(1, len(unique)), key=lambda i: (unique[i][0] - first[0]) ** 2 + (unique[i][1] - first[1]) ** 2)
    # A narrower channel may need more vertices to avoid introducing a crossing.
    # Retry at finer tolerances before falling back to the exact original ring.
    for factor in [1, .5, .25, .125]:
        ring = rdp(unique[:split + 1], tolerance * factor)[:-1] + rdp(unique[split:] + [first], tolerance * factor)
        if len({tuple(p) for p in ring[:-1]}) >= 3 and signed_area(ring) * signed_area(original) > 0 and not self_intersects(ring):
            return ring
    return original


def geometries(document):
    if document['type'] == 'FeatureCollection':
        for feature in document['features']:
            yield feature['geometry']
    elif document['type'] == 'Feature':
        yield document['geometry']
    else:
        yield document


def polygons(geometry):
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    raise ValueError('The country source must contain Polygon or MultiPolygon geometry.')


def outline_stats(document):
    all_polygons = [polygon for geometry in geometries(document) for polygon in polygons(geometry)]
    rings = [ring for polygon in all_polygons for ring in polygon]
    points = [point for ring in rings for point in ring]
    return dict(polygons=len(all_polygons), holes=sum(len(polygon) - 1 for polygon in all_polygons), rings=len(rings),
                vertices=len(points), bounds=[min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)])


def validate(source, result, tolerance):
    source_stats, result_stats = outline_stats(source), outline_stats(result)
    for name in ['polygons', 'holes', 'rings']:
        if source_stats[name] != result_stats[name]:
            raise ValueError(f'{name} count changed.')
    maximum_error = 0
    for before, after in zip(geometries(source), geometries(result)):
        if before['type'] != after['type']:
            raise ValueError('Geometry type changed.')
        for source_polygon, target_polygon in zip(polygons(before), polygons(after)):
            for source_ring, target_ring in zip(source_polygon, target_polygon):
                if len(target_ring) < 4 or target_ring[0] != target_ring[-1] or len({tuple(p) for p in target_ring[:-1]}) < 3:
                    raise ValueError('Invalid closed ring.')
                if any(len(p) < 2 or not all(math.isfinite(n) for n in p) for p in target_ring):
                    raise ValueError('Non-finite coordinate.')
                if target_ring == source_ring:
                    continue
                segments = list(zip(target_ring, target_ring[1:]))
                for point in source_ring:
                    error = math.sqrt(min(segment_distance_squared(point, a, b) for a, b in segments))
                    maximum_error = max(maximum_error, error)
                    if error > tolerance + 1e-10:
                        raise ValueError('Simplified outline exceeded the requested tolerance.')
    if any(abs(a - b) > tolerance + 1e-10 for a, b in zip(source_stats['bounds'], result_stats['bounds'])):
        raise ValueError('Country bounds changed beyond tolerance.')
    return source_stats, result_stats, maximum_error


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / 'data/indonesia.geojson')
    parser.add_argument('--output', type=Path, default=root / 'data/indonesia-overview.geojson')
    parser.add_argument('--tolerance', type=float, default=.025)
    args = parser.parse_args()
    if not math.isfinite(args.tolerance) or args.tolerance <= 0:
        parser.error('tolerance must be positive and finite')
    if args.source.resolve() == args.output.resolve():
        parser.error('the derivative must not overwrite the source')
    source = json.loads(args.source.read_text())
    result = deepcopy(source)
    for geometry in geometries(result):
        for polygon in polygons(geometry):
            for index, ring in enumerate(polygon):
                polygon[index] = simplify_ring(ring, args.tolerance)
    before, after, error = validate(source, result, args.tolerance)
    args.output.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(json.dumps(dict(source=str(args.source), output=str(args.output), toleranceDegrees=args.tolerance,
                          sourceBytes=args.source.stat().st_size, outputBytes=args.output.stat().st_size,
                          sourceStats=before, outputStats=after, maximumVertexErrorDegrees=error), indent=2))


if __name__ == '__main__':
    main()
