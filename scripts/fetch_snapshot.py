#!/usr/bin/env python3
"""Fetch one public NASA FIRMS snapshot and retain Indonesian detections.

Run from any directory: python3 scripts/fetch_snapshot.py
Requires Python 3 and the system curl command for verified, bounded HTTPS.
No API key is needed for the public rolling CSV download.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCE_URL = (
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
    "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv"
)
DOCUMENTATION_URL = "https://firms.modaps.eosdis.nasa.gov/active_fire/"
BBOX = (94.5, -11.5, 141.5, 6.5)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def download(url: str) -> bytes:
    """Use one total deadline, rather than urllib's per-socket timeout.

    A server that trickles bytes can keep a urllib read alive indefinitely.
    curl's --max-time bounds the entire transfer; the subprocess deadline also
    bounds stalled DNS/host networking. System curl preserves host CA trust.
    """
    try:
        process = subprocess.run(
            ["curl", "--fail", "--location", "--silent", "--show-error",
             "--proto", "=https", "--proto-redir", "=https",
             "--connect-timeout", "10",
             "--max-time", "60", "--max-filesize", "31457280", url],
            check=True, capture_output=True, timeout=65,
        )
    except FileNotFoundError as error:
        raise ValueError("Snapshot refresh requires the system curl command") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError("NASA download exceeded its 65-second deadline; prior snapshot was retained") from error
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", errors="replace").strip()[:500]
        raise ValueError(f"NASA download failed: {detail}; prior snapshot was retained") from error
    result = process.stdout
    if len(result) > 30 * 1024 * 1024:
        raise ValueError("NASA response exceeds the 30 MB download limit")
    return result


def point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    previous = ring[-1]
    for current in ring:
        ax, ay = previous[:2]
        bx, by = current[:2]
        # A boundary point is included. Coordinates are geographic degrees.
        cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
        if (abs(cross) < 1e-10 and min(ax, bx) - 1e-10 <= x <= max(ax, bx) + 1e-10
                and min(ay, by) - 1e-10 <= y <= max(ay, by) + 1e-10):
            return True
        if (ay > y) != (by > y):
            if x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
        previous = current
    return inside


def load_country_polygons(path: Path) -> list:
    data = json.loads(path.read_text())
    if data["type"] == "FeatureCollection":
        geometries = [item["geometry"] for item in data["features"]]
    elif data["type"] == "Feature":
        geometries = [data["geometry"]]
    else:
        geometries = [data]
    result = []
    for geometry in geometries:
        if geometry["type"] not in ("MultiPolygon", "Polygon"):
            raise ValueError("Country boundary must contain polygons")
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        for polygon in polygons:
            outer = polygon[0]
            xs, ys = zip(*[(coordinate[0], coordinate[1]) for coordinate in outer])
            result.append(((min(xs), min(ys), max(xs), max(ys)), polygon))
    return result


def inside_country(longitude: float, latitude: float, polygons: list) -> bool:
    for (west, south, east, north), rings in polygons:
        if not (west <= longitude <= east and south <= latitude <= north):
            continue
        if point_in_ring(longitude, latitude, rings[0]) and not any(
            point_in_ring(longitude, latitude, hole) for hole in rings[1:]
        ):
            return True
    return False


def number(value: str | None) -> float | None:
    try:
        parsed = float(value) if value not in (None, "") else None
        return parsed if parsed is not None and math.isfinite(parsed) else None
    except ValueError:
        return None


def normalize(raw: bytes, polygons: list) -> tuple[list, dict]:
    csv_text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(csv_text))
    required = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "frp"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("Response is not the expected NASA VIIRS CSV; prior snapshot was retained")
    records = []
    seen = set()
    stats = {"downloadedRows": 0, "boundingBoxRows": 0, "outsideCountryRows": 0,
             "invalidRows": 0, "duplicateRows": 0}
    for row in reader:
        stats["downloadedRows"] += 1
        latitude, longitude = number(row["latitude"]), number(row["longitude"])
        if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            stats["invalidRows"] += 1
            continue
        if not (BBOX[0] <= longitude <= BBOX[2] and BBOX[1] <= latitude <= BBOX[3]):
            continue
        stats["boundingBoxRows"] += 1
        if polygons and not inside_country(longitude, latitude, polygons):
            stats["outsideCountryRows"] += 1
            continue
        try:
            observation = datetime.strptime(
                row["acq_date"] + " " + row["acq_time"].strip().zfill(4), "%Y-%m-%d %H%M"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            stats["invalidRows"] += 1
            continue
        observed_at = iso_utc(observation)
        identity = f"{row['satellite']}|{observed_at}|{latitude}|{longitude}"
        if identity in seen:
            stats["duplicateRows"] += 1
            continue
        seen.add(identity)
        records.append({
            "id": "viirs-" + hashlib.sha256(identity.encode()).hexdigest()[:16],
            "latitude": latitude,
            "longitude": longitude,
            "observedAt": observed_at,
            "frp": number(row.get("frp")),
            "confidence": row.get("confidence", "unknown"),
            "dayNight": row.get("daynight", ""),
            "satellite": {"N20": "NOAA-20", "1": "NOAA-20"}.get(row["satellite"], row["satellite"]),
            "instrument": "VIIRS",
            "brightness": number(row.get("bright_ti4")),
            "brightnessTi5": number(row.get("bright_ti5")),
            "scan": number(row.get("scan")),
            "track": number(row.get("track")),
            "version": row.get("version", ""),
        })
    records.sort(key=lambda item: (item["observedAt"], item["id"]))
    stats["retainedRows"] = len(records)
    return records, stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-csv", type=Path, help="Reprocess a local raw CSV without fetching again")
    parser.add_argument("--boundary", type=Path, default=DATA / "indonesia.geojson")
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    if not args.boundary.is_file():
        raise FileNotFoundError("Country boundary missing; restore data/indonesia.geojson before fetching")
    polygons = load_country_polygons(args.boundary)
    if args.from_csv:
        raw = args.from_csv.read_bytes()
        fetched_at = datetime.fromtimestamp(args.from_csv.stat().st_mtime, timezone.utc)
    else:
        raw = download(SOURCE_URL)
        fetched_at = datetime.now(timezone.utc)
    records, stats = normalize(raw, polygons)
    notes = [
        "This is a fixed snapshot of a rolling 24-hour source, not a live feed.",
        "Each detection marks a satellite pixel containing a thermal anomaly; it is not a distinct wildfire, fire perimeter, or burned-area estimate.",
        "Detections may include agricultural burning, industrial heat, or volcanoes. Clouds and satellite overpass timing can hide fires.",
        "Only NOAA-20 is included, avoiding overlap between different satellites; multiple detections may still belong to the same fire.",
        "A generalized Natural Earth 1:10m boundary filters detections to Indonesia; tiny islands and some coastal detections may be omitted.",
    ]
    snapshot = {
        "schemaVersion": 1,
        "source": {
            "name": "NASA FIRMS — NOAA-20 VIIRS Collection 2",
            "url": SOURCE_URL,
            "documentationUrl": DOCUMENTATION_URL,
            "sensor": "VIIRS NOAA-20",
            "nominalResolutionMeters": 375,
            "frpUnit": "MW",
            "brightnessUnit": "K",
            "rawFile": "data/raw-noaa20-24h.csv",
            "rawSha256": hashlib.sha256(raw).hexdigest(),
        },
        "fetchedAt": iso_utc(fetched_at),
        "observationStart": records[0]["observedAt"] if records else None,
        "observationEnd": records[-1]["observedAt"] if records else None,
        "windowLabel": "NASA rolling 24-hour snapshot",
        "geographicFilter": {
            "country": "Indonesia",
            "iso3": "IDN",
            "method": "point-in-polygon",
            "boundary": "data/indonesia.geojson",
            "boundarySource": "Natural Earth 1:10m",
            "approximate": True,
            "prefilterBbox": list(BBOX),
        },
        "counts": stats,
        "notes": notes,
        "records": records,
    }
    # Validate completely before replacing the last good snapshot.
    serialized = json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    raw_path = DATA / "raw-noaa20-24h.csv"
    if not args.from_csv or args.from_csv.resolve() != raw_path.resolve():
        raw_path.write_bytes(raw)
    temp_path = DATA / "fire-snapshot.json.tmp"
    temp_path.write_text(serialized, encoding="utf-8")
    temp_path.replace(DATA / "fire-snapshot.json")
    print(json.dumps({"records": len(records), "fetchedAt": snapshot["fetchedAt"],
                      "observationStart": snapshot["observationStart"],
                      "observationEnd": snapshot["observationEnd"], "counts": stats}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Snapshot refresh failed: {error}", file=sys.stderr)
        raise SystemExit(1)
