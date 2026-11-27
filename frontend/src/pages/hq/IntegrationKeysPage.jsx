import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import AdminBoardFrame from '../admin/AdminBoardFrame';
import { IntegrationKeysPanel } from '../admin/consoles/IntegrationKeysConsole';
import { GithubSyncPanel } from '../admin/consoles/GithubSyncConsole';

/**
 * HQ · Integration keys — the Super Admin's own row (the owner's ruling,
 * 2026-10-20). The providers' OAuth keys and, below them, GitHub Sync: the
 * mirror's token and webhook secret, which are the same kind of thing (a
 * credential the Worker holds as a secret) and were the next tab over.
 *
 * Both used to be tabs of the Admin Console (`/admin`, the `integration-keys`
 * and `github` tabs), open to every admin, and items of the Platform strip.
 * The owner moved them here, Super Admin only: App.jsx wraps the route in
 * `hqOnly`, the Worker's reads take `requireSuperAdmin`, and the writes keep
 * D223's `requireSuperAdminWriteBar`. The old links redirect here
 * (`LegacyContractsRedirect`), `?tab=github` to `#github`.
 *
 * The rail is the board's frame, in the viewer's tier, named for the section
 * the address opens: H27 Integration keys, or H28 GitHub sync at `#github`.
 */
export default function IntegrationKeysPage() {
  const { hash } = useLocation();
  const github = hash === '#github';
  const board = github ? 'GitHub sync' : 'Integration keys';
  const githubRef = useRef(null);
  useEffect(() => {
    if (github) githubRef.current?.scrollIntoView?.({ block: 'start' });
  }, [github]);

  return (
    <AdminBoardFrame
      workspace={board}
      note={`Eadwyn reads the ${board} section on this page. Nothing here changes until you act on it.`}
      data-testid="hq-integration-keys-page"
    >
      <div className="min-w-0 space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            <KeyRound size={18} aria-hidden="true" /> Integration keys
          </h1>
          <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">
            The keys Axal holds for each provider, and GitHub Sync&apos;s token. Super Admin only.
          </p>
        </div>
        <section aria-labelledby="hq-keys-providers" data-testid="hq-integration-keys-section">
          <h2 id="hq-keys-providers" className="sr-only">Provider keys</h2>
          <IntegrationKeysPanel />
        </section>
        <section
          id="github"
          ref={githubRef}
          aria-labelledby="hq-keys-github"
          className="scroll-mt-4 border-t border-axal-hairline pt-6 dark:border-gray-800"
          data-testid="hq-github-sync-section"
        >
          <h2 id="hq-keys-github" className="mb-3 text-base font-bold text-axal-ink dark:text-gray-100">GitHub Sync</h2>
          <GithubSyncPanel />
        </section>
      </div>
    </AdminBoardFrame>
  );
}
