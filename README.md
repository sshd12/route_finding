# Comfortwalk

A Next.js walking-route research application. Synthetic examples remain available; real-data adapters, provisional graph search, elevation sampling, exports and a seeded study runner are implemented. The final research cost and its validated parameters remain undecided.

## Run

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

On Windows use `Copy-Item .env.example .env.local`. Open http://localhost:3000. Choose **Real walk**, place or enter endpoints, then **Find walking routes**. The supplied public Valhalla URL is the interactive default. Synthetic samples are explicitly labeled and are never substituted for a failed real request.

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is optional. Without it, Leaflet uses OpenStreetMap tiles. Restrict a browser key to your site origins and the Maps JavaScript API. Map providers display geometry; all hill calculations and custom graph search run separately.

## Network and elevation services

`VALHALLA_URL` must provide `/route` and preferably `/trace_attributes`. Candidate requests use pedestrian costing, an explicit `shortest: true` distance baseline, and hill-preference alternatives. Exact duplicate encoded geometry is removed. The public service is https://valhalla1.openstreetmap.de, [documented by Valhalla](https://github.com/valhalla/valhalla#demo-server). This application sends an identifying `X-Client-Id`. Use services permitted for batch workloads when collecting research datasets; public demos are subject to fair-use limits.

`ELEVATION_URL` provides a Valhalla-compatible `/height` endpoint; if omitted, the routing service's height endpoint is used. Elevations are estimated from that service's DEM, not from OSM map tiles or OSM `ele`/`incline` tags. Missing elevations, nulls and invalid/sentinel values fail the request without replacement. Trace failures retain original geometry with unverified surface attributes and exclude that route's energy from ranking and study analysis.

Record the actual installed sources in `.env.local`:

```dotenv
ELEVATION_DATASET=your dataset name, acquisition/version and source
ELEVATION_DATUM=your dataset's vertical datum
ELEVATION_RESOLUTION_M=your grid's horizontal resolution in meters
OSM_DATA_VERSION=your extract date/version
```

Do not copy example metadata as factual claims. The supplied public server does not return this provenance with its height responses: interactive results therefore show unverified metadata. Such results are excluded from study analysis. A 10 m sampling interval does not imply a 10 m DEM resolution or accuracy.

### Local high-resolution DEM

For San Francisco, investigate [USGS 3DEP bare-earth DEMs](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) or documented local lidar products. Check coverage, horizontal/vertical units, datum, acquisition date, accuracy and licenses. A bare-earth grid still cannot describe every elevated walking surface.

A local GeoTIFF adapter is supplied:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r scripts/requirements-elevation.txt
.venv\Scripts\python.exe scripts/elevation_server.py --dem "data/dem/*.tif" --vertical-units meters
```

On Unix use `.venv/bin/python`. Set `ELEVATION_URL=http://127.0.0.1:8003`. It transforms WGS84 coordinates into each raster's CRS and bilinearly interpolates pixel centers. Feet can be converted with `--vertical-units feet`. It does not transform vertical datums: all tiles must use the documented common datum. Missing coverage, no-data neighbors, and unsupported tile-border interpolation return null. Overlapping tiles can fill these gaps. No San Francisco DEM is bundled or silently downloaded.

## Experimental graph search

Enable **Include experimental graph search**. Supply either `OSM_GRAPH_FILE` (a saved Overpass JSON extract with nodes, ways and tags) or `OVERPASS_URL` (an interpreter endpoint). Repeated studies should use a saved extract. An Overpass query for a chosen region is:

```text
[out:json][timeout:45];
way[highway](SOUTH,WEST,NORTH,EAST);
(._;>;);
out body;
```

Save the complete response under `data/` and configure its relative or absolute path. Interrupted queries with an Overpass `remark`, missing nodes, and oversized graphs are rejected. Interactive queries pad the endpoint rectangle by 750 m and limit its area to 25 km²; complete returned ways may extend beyond it. Graph sampling is limited to 30,000 unique positions. Smaller regions or larger intervals reduce work. Boundaries and graph SHA-256 hashes/snapshots are included in JSON exports.

The directed graph applies conservative highway/foot/access rules, honors `oneway:foot` and directional pedestrian prohibitions, and ignores vehicle-only oneway tags. It excludes conditional access, unsupported barriers, mapped separate-sidewalk carriageways, indoor ways, bridges, tunnels and stairs. It also excludes edges with modeled grades outside ±45%. Endpoint snapping uses the nearest modeled node within 100 m; snapping gaps are reported and excluded from route distance. Pedestrian turn restrictions, open-area crossings and continuous edge snapping are not implemented. These constraints define the feasible research graph and limit its suitability for navigation.

Both graph routes use identical snapped endpoints and exclusions. A* and Dijkstra minimize:

```text
edge cost = distance + uphillWeight × ascent + downhillWeight × descent
```

The exploratory defaults are 12 and 3 meters per elevation meter. The graph baseline sets both weights to zero. Nonnegative penalties make straight-line distance an admissible A* heuristic. Optimality applies only within this modeled graph. Valhalla candidates use a separate graph and can snap differently; their comparisons are candidate comparisons rather than proof of custom-cost optimality.

Maximum grade and normalized averages are not additive edge objectives. They remain analysis/ranking criteria; the manuscript's final A*/Dijkstra formula will follow metric analysis. The interface defaults to the provisional distance-plus-hill score. Energy per meter is available as the study reference, and total trip energy is displayed separately.

## Measurements and exports

The reference is `docs/research-reference.tex`:

- Ascent/descent: sum positive/negative height changes, meters.
- Mean absolute grade: `100 × Σ |Δh| / D`, percent.
- Maximum absolute grade: `100 × max |Δh / d|`, percent.
- Signed decimal Minetti polynomial: `C(g) = 280.5g⁵ − 58.7g⁴ − 76.8g³ + 51.9g² + 19.6g + 2.5`, J/kg/m.
- Total modeled energy: `Σ C(g)d`, J/kg. Study reference: `CR = E / D`, J/kg/m.
- Spearman: Pearson correlation of average tied ranks; constant ranks are undefined.

Real route geometry retains every vertex. Each segment is subdivided into equal lengths of at most the selected interval. Horizontal great-circle distances supply explicit segment lengths; there is no smoothing. This vertex-preserving rule is applied to both candidate profiles and graph edges. Vertex density, DEM alignment/noise and interval affect grade measurements. Provider-reported distances are retained separately.

Grades outside ±45% are flagged as model extrapolations. Bridges, tunnels, stairs, indoor paths, ferries and unverified trace attributes invalidate ground-DEM energy comparison. These energies are excluded from energy-based rankings and study correlations. JSON exports retain profiles, source metadata, requested endpoints, sampling/search parameters, failures and graph snapshots. CSV supplies metric units; GeoJSON preserves longitude/latitude/elevation order. Synthetic exports remain labeled synthetic. OSM-derived network data requires OpenStreetMap attribution and applicable ODbL obligations.

## Reproducible study

Use **Study runner** with an authoritative WGS84 Polygon/MultiPolygon boundary, seed and pair count. Uniform longitude/latitude draws are restricted to the supplied boundary intersected with the San Francisco bounding box `[37.708, -122.515, 37.833, -122.35]`; administrative offshore areas beyond this frame are excluded. Holes and multipolygons are supported. Choose your study sampling frame deliberately; no approximate polygon is presented as an official city boundary.

Configure documented elevation/network metadata and `ALLOW_BATCH_STUDIES=true` with services permitted for batch use. Browser and CLI studies run sequentially and retain unsuccessful endpoint pairs without replacement. Three intervals (10, 20, 40 m) test complete-pipeline sensitivity: both routes and metrics may change. UI default endpoint separation is 100 m–5 km and requests are capped at 50 pairs per run.

```sh
pnpm study --boundary boundary.geojson --seed 42 --pairs 10 --spacings 10,20,40 --graph false --out study-output/run-42
```

The CLI also accepts `--min-distance`, `--max-distance`, `--uphill`, and `--downhill`. Output files are created exclusively to protect prior runs. Dataset JSON records all endpoint pairs, parameters, profiles, errors, metadata and boundaries. Analysis reports eligible/excluded/duplicate routes, pooled and within-pair Spearman correlations, and 95% percentile intervals from 500 seeded endpoint-pair bootstrap replicates. Degenerate replicates and sample counts are reported. CSV covers routes; JSON retains failures.

Exact duplicate geometry, synthetic data, unverified provenance, unsupported surfaces and out-of-range energy are excluded from analysis. Candidate routes share endpoints and streets; pair-level resampling addresses within-pair dependence but not dependence between different pairs sharing streets. Selection bias from failures and limited candidates remains. Metric/energy correlations share slope inputs and do not independently validate effort or establish a final comfort metric. No actual study findings are bundled.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
.venv/Scripts/python.exe tests/elevation_test.py
```

CI runs application checks and GeoTIFF interpolation tests. The committed pnpm lockfile records the installed dependency set. Fonts use local system families so builds do not fetch Google Fonts. Tests cover the manuscript equations, tied ranks, reversal, graph search/access, provider contracts, resampling, no-data rejection, deterministic sampling, failed pairs and exports. Test fixtures are synthetic verification inputs, never research findings.
