/** D7145: require a single, literal main branch policy before using release credentials. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'AxalNetwork/StudioOS';
const environmentUrl = `https://api.github.com/repos/${repository}/environments/production`;

export async function verifyProductionEnvironment(context, request = fetch) {
  if (context.GITHUB_REPOSITORY !== repository || context.GITHUB_REF !== 'refs/heads/main' || !context.GH_TOKEN) {
    throw new Error('Production policy verification requires the canonical main branch and Actions read access.');
  }

  async function get(url) {
    const response = await request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${context.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Unable to read the production deployment policy (HTTP ${response.status}).`);
    return response.json();
  }

  const environment = await get(environmentUrl);
  const mode = environment?.deployment_branch_policy;
  // The fixed endpoint resolves GitHub's environment identity, including its stored display name.
  if (mode?.custom_branch_policies !== true || mode.protected_branches !== false) {
    throw new Error('The production environment must select deployment branches explicitly.');
  }

  const page = await get(`${environmentUrl}/deployment-branch-policies?per_page=100`);
  const policies = page?.branch_policies;
  // total_count covers additional pages. A tag called main is a distinct policy.
  if (page?.total_count !== 1 || !Array.isArray(policies) || policies.length !== 1 ||
      policies[0]?.type !== 'branch' || policies[0]?.name !== 'main') {
    throw new Error('The production environment must allow exactly the main branch and no other branches or tags.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await verifyProductionEnvironment(process.env);
    console.log('Verified the main-only production environment policy.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
