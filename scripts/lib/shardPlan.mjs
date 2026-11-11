// D5609: deterministic longest-first packing and exact-once coverage of test files.
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function assertExactOnce(plan, files) {
  const expected = new Set(files);
  if (expected.size !== files.length) throw new Error('duplicate input file');
  const seen = new Set();
  for (const part of plan) for (const file of part.files) {
    if (!expected.has(file)) throw new Error(`extra file: ${file}`);
    if (seen.has(file)) throw new Error(`repeated file: ${file}`);
    seen.add(file);
  }
  for (const file of expected) if (!seen.has(file)) throw new Error(`missing file: ${file}`);
}

export function planParts({ files, timings = {}, parts }) {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be a positive integer');
  const duration = (file) => {
    const value = timings[file];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  };
  // Called once per suite: unknown files inherit this suite's p90, not another suite's.
  const known = files.map(duration).filter((x) => x !== undefined).sort((a, b) => a - b);
  const p90 = known.length ? known[Math.ceil(known.length * 0.9) - 1] : 1;
  const weight = (file) => duration(file) ?? p90;
  const plan = Array.from({ length: parts }, () => ({ files: [], estimatedMs: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || order(a, b))) {
    let lightest = 0;
    for (let i = 1; i < parts; i++) if (plan[i].estimatedMs < plan[lightest].estimatedMs) lightest = i;
    plan[lightest].files.push(file);
    plan[lightest].estimatedMs += weight(file);
  }
  for (const part of plan) part.files.sort(order);
  assertExactOnce(plan, files);
  return plan;
}

// A verified queue SHA can already be main even though its artifact still names a queue branch.
export function newestMainArtifact(artifacts, commits) {
  const main = new Set(commits.map((c) => c.sha));
  return artifacts.filter((a) => !a.expired && a.name?.startsWith('test-deps-') && Number.isSafeInteger(a.id) && a.id > 0 && main.has(a.workflow_run?.head_sha))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0] || null;
}
