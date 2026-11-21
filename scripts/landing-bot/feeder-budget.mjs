// #6481. Charge the UTC day before any write. All reads are made with the
// workflow's read token. The workflow's single concurrency group serializes
// plan, artifact upload and enqueue across its scheduled and manual runs.
const WORKFLOW = '.github/workflows/landing-feeder.yml';
const JOB = 'Feed the merge queue';
const UPLOAD = 'Reserve daily queue slots';
const PREFIX = 'landing-feed-';
const namePattern = /^landing-feed-(\d{4}-\d{2}-\d{2})-([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)$/;

function positive(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function reservationName({ day, runId, attempt, slots }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || ![runId, attempt].every(positive) ||
      !Number.isSafeInteger(slots) || slots < 0) {
    throw new Error('Invalid daily queue reservation.');
  }
  return `${PREFIX}${day}-${runId}-${attempt}-${slots}`;
}

// The total must stay stable across pages. A missing/duplicated page must
// never turn previously reserved slots into free slots.
async function list(get, path, key) {
  const rows = [];
  const ids = new Set();
  const separator = path.includes('?') ? '&' : '?';
  let total;
  for (let page = 1; ; page++) {
    const result = await get(`${path}${separator}per_page=100&page=${page}`);
    const chunk = result?.[key];
    if (!Array.isArray(chunk) || !Number.isSafeInteger(result.total_count) || result.total_count < 0 ||
        result.total_count >= 1000 || (total !== undefined && result.total_count !== total)) {
      throw new Error(`Incomplete daily queue inventory: ${key}.`);
    }
    total = result.total_count;
    for (const row of chunk) {
      if (!positive(row?.id) || ids.has(row.id)) throw new Error(`Duplicate or unreadable ${key} ID.`);
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (rows.length > total || chunk.length !== 100) throw new Error(`Incomplete page of ${key}.`);
  }
}

// Use the repository listing only as positive evidence for the trusted run IDs.
// Incomplete, unordered or lagging bulk results fall back to inspecting each
// missing run. A skipped/failed sweep that uploaded nothing cannot hide usage.
async function recentFiles(get, runs, day) {
  const known = new Set(runs.map(run => run.id));
  const matched = new Map();
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const batch = (await get(`actions/artifacts?per_page=100&page=${page}`))?.artifacts;
    if (!Array.isArray(batch)) throw new Error('Unreadable repository artifact inventory.');
    for (const file of batch) {
      const id = file?.workflow_run?.id;
      if (!known.has(id) || !file.name?.startsWith(PREFIX) || seen.has(file.id)) continue;
      if (!matched.has(id)) matched.set(id, []);
      matched.get(id).push(file);
      seen.add(file.id);
    }
    if (batch.length < 100 || batch.some(file => typeof file.created_at === 'string' && file.created_at.slice(0, 10) < day)) break;
  }
  return matched;
}

async function chargeRun(get, run, day, current, expectedSlots, hints) {
  const path = `actions/runs/${run.id}`;
  // A serialized first attempt uploads at most one reservation. For reruns, or
  // if the sample did not find one, obtain the complete per-run inventory.
  const files = (run.run_attempt === 1 && hints.length > 0) ? hints : await list(get, `${path}/artifacts`, 'artifacts');
  const reservations = new Map();
  for (const file of files) {
    if (typeof file.name !== 'string') throw new Error('Unreadable queue artifact name.');
    if (!file.name.startsWith(PREFIX)) continue;
    const match = namePattern.exec(file.name);
    if (!match) throw new Error('Malformed queue reservation artifact.');
    const [, date, id, attempt, slots] = match;
    const index = Number(attempt), value = Number(slots);
    if (date !== day || Number(id) !== run.id || !positive(index) || index > run.run_attempt ||
        !Number.isSafeInteger(value) || reservations.has(index) || (file.workflow_run && file.workflow_run.id !== run.id)) {
      throw new Error('Conflicting daily queue reservation.');
    }
    if (current && file.expired !== false) throw new Error('Current queue reservation is unavailable.');
    reservations.set(index, value);
  }
  if (current) {
    if ((reservations.get(1) ?? 0) !== expectedSlots) throw new Error('Current queue reservation does not match the plan.');
  } else if (!reservations.size && run.run_attempt === 1 && run.conclusion === 'skipped') {
    return 0;
  } else if (reservations.size < run.run_attempt) {
    // Artifacts may be deleted independently of a run. A skipped upload is a
    // genuine no-op; a successful upload with missing evidence stops the sweep.
    for (let index = 1; index <= run.run_attempt; index++) {
      if (reservations.has(index)) continue;
      const jobs = (await list(get, `${path}/attempts/${index}/jobs`, 'jobs')).filter(job => job.name === JOB);
      if (jobs.length) {
        const job = jobs[0];
        const upload = job.steps?.find(step => step.name === UPLOAD);
        if (jobs.length !== 1) throw new Error('Ambiguous feeder job history.');
        if (upload?.conclusion === 'skipped' || job.conclusion === 'skipped') continue;
        if (['queued', 'waiting'].includes(job.status) && !upload?.started_at) continue;
        throw new Error('A feeder job lacks an identifiable skipped upload or its reservation artifact.');
      }
      // A run cancelled before being allocated cannot have made a write.
      if (index === run.run_attempt && (['queued', 'waiting', 'requested'].includes(run.status) ||
          ['cancelled', 'skipped'].includes(run.conclusion))) continue;
      throw new Error('Missing feeder job history.');
    }
  }
  let used = 0;
  for (const value of reservations.values()) used += value;
  return used;
}

/** expectedSlots is 0 during planning and the uploaded count during execution.
 * get(path) is a repository-relative GET returning decoded JSON, not a write token.
 */
export async function readDailyReservations({ get, day, runId, attempt, expectedSlots = 0, now = Date.now }) {
  const today = () => new Date(typeof now === 'function' ? now() : now).toISOString().slice(0, 10);
  if (day !== today() || attempt !== 1 || !positive(runId) ||
      !Number.isSafeInteger(expectedSlots) || expectedSlots < 0) {
    throw new Error('Refusing a rerun, invalid reservation or UTC day rollover.');
  }
  const range = `${day}T00:00:00Z..${day}T23:59:59Z`;
  const all = await list(get, `actions/workflows/landing-feeder.yml/runs?branch=main&created=${encodeURIComponent(range)}`, 'workflow_runs');
  const runs = all.filter(run => {
    if (typeof run.path !== 'string' || typeof run.event !== 'string' || typeof run.head_branch !== 'string') {
      throw new Error('Incomplete feeder run identity.');
    }
    return [WORKFLOW, WORKFLOW + '@main', WORKFLOW + '@refs/heads/main'].includes(run.path) &&
      run.head_branch === 'main' && ['schedule', 'workflow_dispatch'].includes(run.event);
  });
  if (!runs.some(run => run.id === runId && run.run_attempt === attempt)) {
    throw new Error('Current feeder run is missing from today’s default-branch history.');
  }
  const hints = await recentFiles(get, runs, day);
  let used = 0, next = 0;
  // Bounded GET concurrency keeps a full day of 10-minute sweeps practical.
  async function readWorker() {
    while (next < runs.length) {
      const run = runs[next++];
      if (!positive(run.run_attempt) || new Date(run.created_at).toISOString().slice(0, 10) !== day) {
        throw new Error('Feeder run is outside the accounting day or has an unreadable attempt.');
      }
      const charge = await chargeRun(get, run, day, run.id === runId, expectedSlots, hints.get(run.id) ?? []);
      used += charge;
      if (!Number.isSafeInteger(used)) throw new Error('Unsafe reservation total.');
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, runs.length) }, readWorker));
  if (day !== today()) throw new Error('UTC day changed while verifying reservations.');
  return { used, availableForCurrentRun: expectedSlots };
}
