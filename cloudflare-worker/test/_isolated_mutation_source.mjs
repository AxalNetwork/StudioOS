// D6811 (#6811): private source copies for mutation subprocesses; shared checkout files are never mutated.
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Copy the Worker test/import graph and frontend source; only installed dependencies are linked. */
export function isolatedMutationSource(sourceRoot, scratchParent = tmpdir()) {
  const root = mkdtempSync(join(scratchParent, 'studioos-mutation-'));
  const close = () => rmSync(root, { recursive: true, force: true });
  try {
    for (const path of ['package.json', 'cloudflare-worker/package.json', 'cloudflare-worker/src', 'cloudflare-worker/sql',
      'cloudflare-worker/test', 'cloudflare-worker/ai-workers', 'frontend/package.json', 'frontend/src', 'scripts/lib',
      'agent-compute/failureCodes.ts', 'cloudflare-worker-tail/src', 'meeting-bot/notice.mjs', 'merge-control/contract']) {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(resolve(sourceRoot, path), target, { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
    for (const path of ['node_modules', 'cloudflare-worker/node_modules', 'frontend/node_modules']) {
      const dependency = resolve(sourceRoot, path);
      if (existsSync(dependency)) symlinkSync(realpathSync(dependency), resolve(root, path), 'dir');
    }
    return { root, close };
  } catch (error) {
    close();
    throw error;
  }
}
