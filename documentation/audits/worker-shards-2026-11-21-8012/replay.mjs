/** #8012: offline analysis using the published D5609 planner, without running tests. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HISTORICAL = 'af019ea025334d1d4fb6d365bcd8af9ca3c93fdc';
const CURRENT = 'c2fb23a5cc4e440268dce3c65c579a0ee21bf469';
const ARCHIVE_SHA256 = '60db8ccafaa93bd01cc58cd8a5f8db99e1216e00b3cb45051ba0c920ea25012d';
const [repoArg, zipArg, outputArg, ...extra] = process.argv.slice(2);
assert(repoArg && zipArg && outputArg && !extra.length,
  'Usage: node replay.mjs <git-repository> <artifact-14346295606.zip> <output-directory>');
const repo = resolve(repoArg), zip = resolve(zipArg), output = resolve(outputArg);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 192 * 1024 * 1024 });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const worker = file => /^cloudflare-worker\/test\/[^/]+\.test\.(ts|mjs)$/.test(file);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const tree = ref => new Map(git('ls-tree', '-rz', ref).toString().split('\0').filter(Boolean).map(line => {
  const [meta, path] = line.split('\t');
  return [path, meta]; // Includes mode, type and blob identity, without fetching source bodies.
}));
const historicalTree = tree(HISTORICAL), currentTree = tree(CURRENT);
const historicalFiles = [...historicalTree.keys()].filter(worker).sort();
const currentFiles = [...currentTree.keys()].filter(worker).sort();
assert.equal(hash(readFileSync(zip)), ARCHIVE_SHA256, 'artifact ZIP checksum mismatch');
const members = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort();
assert.deepEqual(members, ['test-deps.json', 'test-timings.json']);
const extract = name => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 192 * 1024 * 1024 });
const timingBytes = extract('test-timings.json'), dependencyBytes = extract('test-deps.json');
const timings = JSON.parse(timingBytes), dependencies = JSON.parse(dependencyBytes);
for (const envelope of [timings, dependencies]) {
  assert.equal(envelope.sha, HISTORICAL, 'source SHA mismatch');
  assert.equal(envelope.node, 'v22.23.4');
  assert(envelope.tests && typeof envelope.tests === 'object' && !Array.isArray(envelope.tests));
}
assert(Array.isArray(timings.untraced));
for (const [file, row] of Object.entries(timings.tests)) {
  assert(historicalTree.has(file), `timed path absent from historical source: ${file}`);
  assert(row && Number.isFinite(row.wallMs) && row.wallMs >= 0 && Number.isInteger(row.exitCode));
  assert(dependencies.tests[file], `missing dependency row: ${file}`);
}
for (const row of Object.values(dependencies.tests)) {
  assert.equal(typeof row.opaque, 'boolean');
  for (const list of [row.reads, row.directories, row.modules, row.sqlite, row.children, row.probes?.hits, row.probes?.misses]) {
    assert(Array.isArray(list) && list.every(value => typeof value === 'string'));
  }
}
const positive = file => Number.isFinite(timings.tests[file]?.wallMs) && timings.tests[file].wallMs > 0;
const known = historicalFiles.filter(positive).map(file => timings.tests[file].wallMs).sort((a, b) => a - b);
const p90 = known.length ? known[Math.ceil(known.length * 0.9) - 1] : 1;
const unknown = historicalFiles.filter(file => !positive(file));
const temporary = mkdtempSync(join(tmpdir(), 'worker-shards-8012-'));
mkdirSync(output, { recursive: true });
try {
  // Load the matching published planner and its imports without modifying shared source.
  const source = join(temporary, 'source');
  mkdirSync(source);
  const archive = git('archive', HISTORICAL, 'scripts', 'package.json');
  execFileSync('tar', ['-xf', '-', '-C', source], { input: archive });
  const planner = await import(pathToFileURL(join(source, 'scripts/test-drift-parts.mjs')));
  const { assertExactOnce } = await import(pathToFileURL(join(source, 'scripts/lib/shardPlan.mjs')));
  const scripts = JSON.parse(readFileSync(join(source, 'package.json'))).scripts;
  // Path-only projection for fs.globSync. No test contents are loaded or executed.
  for (const file of historicalFiles) {
    mkdirSync(dirname(join(source, file)), { recursive: true });
    writeFileSync(join(source, file), '');
  }
  assert.deepEqual(planner.suiteFiles(scripts['test:worker'], source), historicalFiles);
  const weights = planner.timingsOf(timings);
  const summaries = [];
  const csv = ['parts,part,files,predicted_additive_ms,equal_weight_assignment_measured_sum_ms'];
  for (const count of [6, 8, 12]) {
    const shards = { 'test:worker': count };
    const generate = input => planner.buildPlan(scripts, input, source, shards).parts.filter(part => part.script === 'test:worker');
    const plan = generate(weights);
    assertExactOnce(plan, historicalFiles);
    assert.equal(json(plan), json(generate(weights)), 'nondeterministic repeated output');
    const reversed = Object.fromEntries(Object.entries(weights).reverse());
    assert.equal(json(plan), json(generate(reversed)), 'timing key order changes output');
    // Existing equal-weight policy, evaluated with the same historical measurements.
    const equalPlan = generate({});
    assertExactOnce(equalPlan, historicalFiles);
    const equalLoads = equalPlan.map(part => part.files.reduce((sum, file) => sum + (positive(file) ? weights[file] : p90), 0));
    const loads = plan.map(part => part.estimatedMs), max = Math.max(...loads), med = median(loads);
    const digest = hash(json(plan));
    writeFileSync(join(output, `plan-${count}.json`), json({ source: HISTORICAL, parts: plan }));
    summaries.push({
      parts: count, files: historicalFiles.length, measuredFiles: known.length, unknownFiles: unknown.length,
      opaqueFiles: historicalFiles.filter(file => dependencies.tests[file]?.opaque).length,
      totalAdditiveMs: loads.reduce((a, b) => a + b, 0), predictedPartLoadsMs: loads,
      maxMs: max, medianMs: med, maxMinusMedianMs: max - med, maxOverMedian: max / med,
      maxMinSpreadFraction: (max - Math.min(...loads)) / max,
      additiveCriticalPathMs: max, longestMeasuredFileMs: Math.max(...known),
      equalWeightAssignmentMeasuredLoadsMs: equalLoads, equalWeightAssignmentMaxMs: Math.max(...equalLoads),
      exactOnce: true, deterministic: true, deterministicWithReversedTimingKeys: true, planSha256: digest,
    });
    plan.forEach((part, index) => csv.push([count, index + 1, part.files.length, part.estimatedMs, equalLoads[index]].join(',')));
  }
  const changedPaths = new Set([...historicalTree.keys(), ...currentTree.keys()].filter(file => historicalTree.get(file) !== currentTree.get(file)));
  const newFiles = currentFiles.filter(file => !historicalTree.has(file));
  const removedFiles = historicalFiles.filter(file => !currentTree.has(file));
  const changedFiles = currentFiles.filter(file => historicalTree.has(file) && changedPaths.has(file));
  const sameFiles = currentFiles.filter(file => historicalTree.get(file) === currentTree.get(file));
  const affectedDependencies = sameFiles.filter(file => {
    const row = dependencies.tests[file];
    if (!row) return false;
    const direct = [...row.reads, ...row.modules, ...row.sqlite, ...row.probes.hits, ...row.probes.misses];
    return direct.some(path => changedPaths.has(path)) || row.directories.some(dir =>
      [...changedPaths].some(path => path.startsWith(`${dir}/`) || path === dir || dir === '.'));
  });
  const inventory = {
    historicalCount: historicalFiles.length, currentCount: currentFiles.length,
    newFiles, removedFiles, changedFiles, sameTestBlobFiles: sameFiles,
    sameTestBlobWithChangedRecordedDependency: affectedDependencies,
    historicalUnknownFiles: unknown,
    historicalOpaqueFiles: historicalFiles.filter(file => dependencies.tests[file]?.opaque),
    currentFilesWithoutHistoricalTiming: currentFiles.filter(file => !positive(file)),
    currentOpaqueFilesFromHistoricalTrace: currentFiles.filter(file => dependencies.tests[file]?.opaque),
    historicalUntraced: timings.untraced,
  };
  const sourcePaths = ['scripts/lib/shardPlan.mjs', 'scripts/test-drift-parts.mjs', 'scripts/ci/merge-test-deps.mjs',
    'scripts/ci/test-tracer.mjs', 'documentation/architecture/decisions/D5609.md', 'package.json', '.github/workflows/ci.yml'];
  const summary = {
    schema: 1, issue: 8012, evidence: 'offline_additive_prediction_from_retained_hosted_file_timings',
    historicalSource: HISTORICAL, currentSource: CURRENT, replayNode: process.version,
    artifact: { id: 14346295606, runId: 44110620304, sha256: ARCHIVE_SHA256, sizeBytes: readFileSync(zip).length,
      createdAt: '2026-11-17T16:04:31Z', expiresAt: '2026-12-17T16:04:28Z',
      timingSha256: hash(timingBytes), dependenciesSha256: hash(dependencyBytes), producerNode: timings.node,
      timingRows: Object.keys(timings.tests).length, dependencyRows: Object.keys(dependencies.tests).length,
      untracedRows: timings.untraced.length,
      failedWorkerTimingRows: historicalFiles.filter(file => timings.tests[file]?.exitCode !== 0),
      envelopeChecksPassed: true },
    unknownWeight: { rule: 'suite positive-duration p90; fallback 1 if no positive durations', historicalP90Ms: p90 },
    sourceIdentities: Object.fromEntries(sourcePaths.map(path => [path, { historical: historicalTree.get(path), current: currentTree.get(path) }])),
    inventoryCounts: Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
    longestFiles: historicalFiles.filter(positive).sort((a, b) => weights[b] - weights[a] || a.localeCompare(b)).slice(0, 20)
      .map(file => ({ file, wallMs: weights[file], opaque: dependencies.tests[file].opaque })),
    comparisons: summaries,
    limits: [
      'No current-source duration prediction: changed tests and dependency closures require fresh evidence.',
      'Opaque denotes incomplete dependency tracing, not a missing wall-time measurement.',
      'Per-file process wall times overlap under node:test concurrency and include contention and tracing overhead.',
      'Additive loads and critical paths assume serial files within each part and simultaneous part starts; they are not hosted elapsed times or runner-minutes.',
      'Checkout, npm installs, runner wait, top-level generation and artifact upload are outside file-process timings.',
      'Per-file loader/setup/child work and SQLite migration work inside the test process contribute to wall time; stage costs cannot be separated from this artifact.',
      'One run supplies maxima across root-process records; raw records, runner hardware, repetition variance and job timestamps are not in this archive.',
      'The live six-part configuration and two-Linux/four-standard-hosted pilot allocation are unchanged.',
    ],
  };
  writeFileSync(join(output, 'summary.json'), json(summary));
  writeFileSync(join(output, 'inventory.json'), json(inventory));
  writeFileSync(join(output, 'parts.csv'), `${csv.join('\n')}\n`);
  console.log(json({ artifactVerified: true, source: HISTORICAL, inventory: summary.inventoryCounts,
    comparisons: summaries.map(({ parts, maxMs, medianMs, maxOverMedian, equalWeightAssignmentMaxMs }) =>
      ({ parts, maxMs, medianMs, maxOverMedian, equalWeightAssignmentMaxMs })) }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
