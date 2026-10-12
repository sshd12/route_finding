const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/routing.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { routes, metrics, walkingCost, spearman, candidates, samplePositions, score } = context.exports;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
near(walkingCost(0), 2.5);
const fixture = { id: 'test', name: 'unequal segments', color: '#000', distance: 300,
  segmentDistances: [100, 200], points: [0, 10, 0].map(elevation => ({lat: 0, lng: 0, elevation})) };
const m = metrics(fixture);
near(m.gain, 10); near(m.loss, 10); near(m.averageGrade, 100 * 20 / 300); near(m.maxGrade, 10);
near(m.totalEnergy, walkingCost(.1) * 100 + walkingCost(-.05) * 200);
near(m.normalizedCost, m.totalEnergy / 300);
assert.equal(m.outsideRange, false);
assert.equal(metrics({...fixture, points: [0, 46, 0].map(elevation => ({elevation}))}).outsideRange, true);
assert.throws(() => metrics({...fixture, segmentDistances: [0, 300]}));
assert.throws(() => metrics({...fixture, distance: 500}));
assert.throws(() => metrics({...fixture, points: [{elevation: NaN}, {elevation: 0}, {elevation: 1}]}));
near(spearman([1,2,3], [1,2,3]), 1);
near(spearman([1,2,3], [3,2,1]), -1);
near(spearman([1,1,2], [1,2,3]), Math.sqrt(3) / 2);
assert.equal(spearman([1,1,1], [1,2,3]), null);
assert.equal(spearman([1], [1]), null);
assert.equal(spearman([1,2], [1]), null);
assert.equal(spearman([1,NaN], [1,2]), null);
for (const [i, reversed] of candidates(true).entries()) {
  const forward = metrics(routes[i]), back = metrics(reversed);
  near(back.gain, forward.loss); near(back.loss, forward.gain);
  near(back.averageGrade, forward.averageGrade); near(back.maxGrade, forward.maxGrade);
  assert.deepEqual(Array.from(reversed.segmentDistances), [...routes[i].segmentDistances].reverse());
  const xs = samplePositions(reversed);
  near(xs[0], 0); near(xs.at(-1), 1);
}
assert.notEqual(metrics(routes[0]).totalEnergy, metrics(candidates(true)[0]).totalEnergy);
assert.equal([...routes].sort((a,b) => score(a,0,0)-score(b,0,0))[0].id, 'direct');
console.log('Passed research metrics, unequal segment weighting, polynomial energy, range flags, tied ranks, reversal, and input validation.');
