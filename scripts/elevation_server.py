"""Local Valhalla-compatible /height service for documented DEM GeoTIFFs.

Usage: python scripts/elevation_server.py --dem "data/dem/*.tif" --vertical-units meters
Ground elevations are bilinearly interpolated. Missing coverage returns null, never zero.
"""
import argparse
import glob
import json
import math
from http.server import BaseHTTPRequestHandler, HTTPServer

import rasterio
from pyproj import Transformer
from rasterio.windows import Window


def interpolate(grid, x, y):
    """Interpolate relative to pixel centers; retain no-data masks."""
    col, row = (~grid.transform) * (x, y)
    col -= 0.5
    row -= 0.5
    left, top = math.floor(col), math.floor(row)
    if left < 0 or top < 0 or left + 1 >= grid.width or top + 1 >= grid.height:
        return None
    values = grid.read(1, window=Window(left, top, 2, 2), masked=True)
    if values.mask.any():
        return None
    dx, dy = col - left, row - top
    height = float(values[0, 0] * (1 - dx) * (1 - dy) + values[0, 1] * dx * (1 - dy)
                   + values[1, 0] * (1 - dx) * dy + values[1, 1] * dx * dy)
    return height if math.isfinite(height) else None


class Elevation:
    def __init__(self, files, vertical_units):
        self.grids = [rasterio.open(file) for file in files]
        if any(grid.crs is None for grid in self.grids):
            raise ValueError("Every DEM must have a horizontal coordinate reference system.")
        self.transforms = [Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True) for grid in self.grids]
        self.factor = 1 if vertical_units == "meters" else 0.3048

    def height(self, lat, lon):
        for grid, transform in zip(self.grids, self.transforms):
            x, y = transform.transform(lon, lat)
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            if grid.bounds.left <= x <= grid.bounds.right and grid.bounds.bottom <= y <= grid.bounds.top:
                value = interpolate(grid, x, y)
                if value is not None:
                    return value * self.factor
        return None


def handler(elevation):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path.rstrip("/") != "/height":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 100000:
                    raise ValueError("Invalid request size.")
                body = json.loads(self.rfile.read(length))
                points = body.get("shape")
                if not isinstance(points, list) or not 1 <= len(points) <= 256:
                    raise ValueError("Provide 1–256 shape locations.")
                precision = body.get("height_precision", 2)
                if precision not in (0, 1, 2):
                    raise ValueError("Invalid height_precision.")
                heights = []
                for point in points:
                    lat, lon = point.get("lat"), point.get("lon")
                    if type(lat) not in (int, float) or type(lon) not in (int, float) or not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
                        raise ValueError("Invalid coordinate.")
                    height = elevation.height(lat, lon)
                    heights.append(round(height, precision) if height is not None else None)
                payload = json.dumps({"shape": points, "height": heights}, allow_nan=False).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (ValueError, TypeError, AttributeError) as error:
                self.send_error(400, str(error))
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", nargs="+", required=True, help="GeoTIFF paths or glob patterns")
    parser.add_argument("--vertical-units", choices=("meters", "feet"), required=True)
    parser.add_argument("--port", type=int, default=8003)
    args = parser.parse_args()
    files = sorted(set(file for pattern in args.dem for file in glob.glob(pattern)))
    if not files:
        parser.error("No DEM files matched.")
    elevation = Elevation(files, args.vertical_units)
    print("Serving {} DEM tiles at http://127.0.0.1:{}/height".format(len(files), args.port), flush=True)
    try:
        HTTPServer(("127.0.0.1", args.port), handler(elevation)).serve_forever()
    finally:
        for grid in elevation.grids:
            grid.close()


if __name__ == "__main__":
    main()
