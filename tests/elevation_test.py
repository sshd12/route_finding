import importlib.util
import unittest

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

spec = importlib.util.spec_from_file_location("elevation_server", "scripts/elevation_server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ElevationTests(unittest.TestCase):
    def test_pixel_centers_and_missing_coverage(self):
        with MemoryFile() as memory:
            with memory.open(driver="GTiff", height=3, width=3, count=1, dtype="float32", crs="EPSG:3857", transform=from_origin(0, 3, 1, 1), nodata=-9999) as grid:
                grid.write(np.array([[0, 10, 20], [20, 30, 40], [40, 50, 60]], dtype="float32"), 1)
                self.assertAlmostEqual(module.interpolate(grid, 1, 2), 15)
                self.assertAlmostEqual(module.interpolate(grid, .5, 2.5), 0)
                self.assertIsNone(module.interpolate(grid, -1, 2))
                grid.write(np.array([[0, -9999, 20], [20, 30, 40], [40, 50, 60]], dtype="float32"), 1)
                self.assertIsNone(module.interpolate(grid, 1, 2))


if __name__ == "__main__":
    unittest.main()
