/** D5535: read-only Cloudflare queue admission for a trusted production candidate. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const requireWorker = createRequire(new URL('../cloudflare-worker/package.json', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const queueName = /^[a-zA-Z0-9_-]+$/;

export function productionQueues(configPath) {
  const { experimental_readRawConfig, unstable_readConfig } = requireWorker('wrangler');
  const args = { config: configPath, cwd: dirname(configPath), env: 'production' };
  const { rawConfig, redirected } = experimental_readRawConfig(args);
  if (redirected || !Object.hasOwn(rawConfig.env ?? {}, 'production')) {
    throw new Error('Expected an explicit production environment in the candidate Wrangler config.');
  }
  const { queues, account_id: configuredAccount } = unstable_readConfig(args, { hideWarnings: true });
  const names = [
    ...queues.producers.map(({ queue }) => queue),
    ...queues.consumers.flatMap(({ queue, dead_letter_queue }) => dead_letter_queue ? [queue, dead_letter_queue] : [queue]),
  ];
  if (!names.every(name => typeof name === 'string' && queueName.test(name))) {
    throw new Error('The production Wrangler config contains an invalid queue name.');
  }
  return { names: [...new Set(names)].sort(), configuredAccount };
}

export async function checkProductionQueues({ names, configuredAccount, account, token, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(account ?? '') || (configuredAccount && account !== configuredAccount)) {
    return { status: 'account_mismatch' };
  }
  if (names.length === 0) return { status: 'verified', required: names };
  if (!token) return { status: 'unauthorized' };

  const remaining = new Set(names);
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/queues`);
  const signal = AbortSignal.timeout(30_000);
  let totalPages;
  for (let page = 1; page <= 100; page += 1) {
    url.searchParams.set('page', String(page));
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal });
      if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
      if (!response.ok) return { status: 'inconclusive' };
      const { success, result, result_info: info } = await response.json();
      if (success !== true || !Array.isArray(result) || !result.every(row => typeof row?.queue_name === 'string')) {
        return { status: 'inconclusive' };
      }
      for (const row of result) remaining.delete(row.queue_name);
      if (remaining.size === 0) return { status: 'verified', required: names };
      if (info?.page !== page || !Number.isSafeInteger(info.total_pages) ||
          info.total_pages < (result.length === 0 && page === 1 ? 0 : page) ||
          (totalPages !== undefined && totalPages !== info.total_pages)) return { status: 'inconclusive' };
      totalPages = info.total_pages;
      if (page >= totalPages) return { status: 'missing', missing: [...remaining] };
    } catch {
      return { status: 'inconclusive' };
    }
  }
  return { status: 'inconclusive' };
}

export function candidateConfig(candidate, cwd = root) {
  const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  if (!/^[a-f0-9]{40}$/.test(candidate ?? '') || git('rev-parse', 'HEAD').toString().trim() !== candidate) {
    throw new Error('Pass the full trusted candidate SHA and check out that exact commit.');
  }
  const config = resolve(cwd, 'wrangler.toml');
  if (!readFileSync(config).equals(git('show', `${candidate}:wrangler.toml`))) {
    throw new Error('The local Wrangler config differs from the candidate commit.');
  }
  return config;
}

const guidance = {
  missing: 'Have the Cloudflare account owner provision the missing production queues, then retry the candidate.',
  unauthorized: 'Check that the release token has queue-list permission on the production account.',
  account_mismatch: 'Check that CLOUDFLARE_ACCOUNT_ID identifies the candidate’s production account.',
  inconclusive: 'Cloudflare queue inventory could not be verified. Check API availability and retry the candidate.',
  invalid_candidate: 'Check out the trusted candidate with its unchanged production Wrangler config and pinned Worker dependencies.',
};

async function main(candidate) {
  let result;
  try {
    const bindings = productionQueues(candidateConfig(candidate));
    result = await checkProductionQueues({ ...bindings, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  } catch {
    result = { status: 'invalid_candidate' };
  }
  const verified = result.status === 'verified';
  console.log(JSON.stringify({ candidate: /^[a-f0-9]{40}$/.test(candidate ?? '') ? candidate : null,
    ...result, ...(!verified && { guidance: guidance[result.status] }) }));
  if (!verified) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv[2]);
}
