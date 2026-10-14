const load = require('./load-ts.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { findRoutes, providerConfig } = load('lib/providers.ts');
const { parseBoundary, runStudy, analyzeStudy } = load('lib/study.ts');
const { studyCsv } = load('lib/exports.ts');
async function main() {
  const flags = new Map();
  for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1]);
  if (!flags.get('--boundary')) throw new Error('Usage: pnpm study --boundary boundary.geojson --seed 42 --pairs 10 --spacings 10,20,40 --graph false --out study-output/run-42');
  const config = providerConfig();
  if (!config.allowBatch) throw new Error('Configure batch-capable services, DEM/OSM metadata and ALLOW_BATCH_STUDIES=true before starting a study.');
  const boundary = parseBoundary(JSON.parse(await fs.readFile(flags.get('--boundary'), 'utf8')));
  const options = { seed: Number(flags.get('--seed') ?? 42), count: Number(flags.get('--pairs') ?? 10), spacings: (flags.get('--spacings') ?? '10,20,40').split(',').map(Number), minDistance: Number(flags.get('--min-distance') ?? 100), maxDistance: Number(flags.get('--max-distance') ?? 5000), graph: flags.get('--graph') === 'true', uphill: Number(flags.get('--uphill') ?? 12), downhill: Number(flags.get('--downhill') ?? 3) };
  const dataset = await runStudy(boundary, options, request => findRoutes(request, config), (completed, total) => process.stdout.write(`Completed ${completed}/${total}\n`));
  const directory = path.resolve(flags.get('--out') ?? 'study-output/run-' + options.seed);
  await fs.mkdir(directory, { recursive: true });
  // Exclusive writes protect prior research runs from accidental overwrite.
  await fs.writeFile(path.join(directory, 'dataset.json'), JSON.stringify(dataset, null, 2), { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'analysis.json'), JSON.stringify(analyzeStudy(dataset), null, 2), { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'routes.csv'), studyCsv(dataset), { flag: 'wx' });
  process.stdout.write(`Saved ${directory}. Failures: ${dataset.records.filter(r => r.error).length}. No independent empirical validation is claimed.\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
