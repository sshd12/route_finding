# Project Overview

This next.js project is a web demonstration for a research project that proposes a new walking route-finding algorithm based on hill metrics. The goal is to develop a custom cost function that considers terrain as well as walking distance, then use that function to recommend routes in the demonstration.

## Research Goals

- Define hill metrics relevant to walking, such as slope, elevation gain, and elevation loss.
- Develop a new route cost function using those metrics.
- Use the custom cost function to evaluate and select walking routes.
- Compare the recommended routes with a distance-based baseline to study how hill metrics affect route selection.

The exact metrics, formula, and weights are research decisions still to be developed. Clearly label provisional assumptions and distinguish them from validated results.

## Web Demonstration

- Use the Google Maps API for the map and route visualization.
- Let users select a starting point and destination.
- Display the route recommended by the research algorithm, along with its distance and relevant hill metrics.
- Keep the cost function and routing logic separate from the map interface so the research model can evolve independently.
- Determine walking-network and elevation data sources during implementation. Displaying a route on Google Maps does not by itself apply the custom cost function.

## Development Guidance

- Document metric definitions, units, data sources, and cost-function parameters.
- Distinguish measured data from estimates and demonstration placeholders.
- Keep calculations modular and reproducible for research evaluation.
- Configure Google Maps credentials through environment variables with appropriate API restrictions; do not commit credentials.

## Supplied Research Reference

Use `docs/research-reference.tex` as the manuscript reference. Compare total ascent, distance-weighted mean absolute grade, and maximum absolute grade with distance-normalized modeled walking energy. Use signed decimal grades in the supplied Minetti polynomial, explicit segment distances, and average ranks for tied Spearman correlations. Flag slopes outside the stated ±45% model range.

The planned data workflow uses randomly sampled San Francisco endpoints, OpenStreetMap and Valhalla candidate routes, and consistently sampled elevation data. These are planned integrations, not existing capabilities. The final A*/Dijkstra cost function follows metric analysis and is not yet determined; maximum grade is non-additive. Synthetic candidate correlations must never be presented as study findings or independent empirical validation.
