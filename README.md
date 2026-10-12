# Comfortwalk

A local Next.js research prototype comparing walking distance with elevation penalties.

## Run

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Optionally copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, and restart. Enable the Google Maps JavaScript API and restrict the browser key to your site origins and that API. Browser keys are publicly visible by design; do not use an unrestricted credential.

## Research boundaries

The three San Francisco routes in `lib/routing.ts` are **synthetic placeholders**, not verified walking paths. Distances and elevation samples are manually supplied. Without a Google Maps key, the default view uses Leaflet with OpenStreetMap tiles, synthetic sample route overlays, and endpoint pins. Select “Pick on map”, choose A or B, and click the map to place a custom endpoint. Coordinate entry, swapping, and clearing pins are also supported. Custom endpoints hide sample comparisons because real routing/elevation services are not yet connected. Pin state lasts while the page is open. The “Sample routes” toggle displays the synthetic comparison diagram. With a key, Google Maps supplies geographic context, not the custom routing computation.

## Reference-based calculations

The supplied “Efficient Walking Route algorithm” manuscript is the research reference for this prototype. `lib/routing.ts` implements:

- Total ascent: `A = Σ max(Δh, 0)`, meters.
- Distance-weighted mean absolute grade: `100 × Σ |Δh| / D`, percent.
- Maximum absolute segment grade: `100 × max |Δh / d|`, percent.
- The supplied Minetti et al. (2002) polynomial: `C(g) = 280.5g⁵ − 58.7g⁴ − 76.8g³ + 51.9g² + 19.6g + 2.5`, J/kg/m, using signed decimal grade.
- Total modeled energy: `Σ C(g) d`, J/kg, and normalized cost `CR = E / D`, J/kg/m.
- Spearman correlations between each hill metric and CR, using average ranks for ties. Constant rankings yield an undefined result.

Each candidate has explicit synthetic segment distances summing to the route distance. Elevation profiles use cumulative segment distance. Reversing a route reverses both elevations and distances; ascent and descent exchange, absolute grades stay the same, and modeled energy may change. Slopes outside ±45% are flagged; energy for such segments is an extrapolation. All calculations depend on elevation resolution and noise.

Ranking can use distance, any hill metric, modeled energy per meter, or a separate experimental score: `distance + uphillWeight * ascent + downhillWeight * descent`. The latter retains provisional defaults of 12 uphill and 3 downhill; it is **not** the manuscript’s finalized routing cost.

The correlations shown for three synthetic candidates are demonstration calculations, not study results or independent validation. Metrics and modeled energy share the same slope inputs.

## Pending study integrations

The manuscript proposes randomly sampled San Francisco endpoints, OpenStreetMap/Valhalla candidate walking routes, and consistently sampled elevation data. None are connected yet. Google Maps supplies only the basemap. After comparing metrics across the real dataset, the search cost must be designed for A*/Dijkstra; maximum grade is non-additive and needs special handling. The final measure, formula, and weights remain research decisions.

Reference attributed by the manuscript: Minetti et al. (2002), [Energy cost of walking and running at extreme uphill and downhill slopes](https://doi.org/10.1152/japplphysiol.01177.2001).

## Validation

```sh
node tests/routing.cjs
pnpm exec tsc --noEmit
pnpm build
# Alternative if Turbopack is unavailable:
pnpm exec next build --webpack
```
