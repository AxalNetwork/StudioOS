import { useEffect, useRef, useState } from 'react';
import GithubRepositoriesPanel from './GithubRepositoriesPanel';

/**
 * D753 F4 (#1957), part 2 — GitHub's page draws its repositories as the
 * page's own Repositories section: the list, the project picker and Sync,
 * from `GithubRepositoriesPanel`, with no Sheet. It reads the repositories on
 * mount. Drawn only for a connection: without one there is nothing to read.
 *
 * `focus` is a return from GitHub (its sign-in, or the App's Setup URL): the
 * section's heading takes focus, which scrolls it into view. Done starts the
 * section over, with a fresh read.
 *
 * When F3 (#1956) lands, this moves into its provider slot of Your connection.
 */
export const REPOSITORIES_ID = 'repositories';

export default function GithubRepositoriesSection({ p, focus = false, onChanged, api, projectsApi, wait }) {
  const conn = p?.connection;
  const heading = useRef(null);
  const [round, setRound] = useState(0);
  const uid = conn?.uid || null;
  useEffect(() => {
    if (focus && uid) heading.current?.focus?.();
  }, [focus, uid]);
  if (!uid) return null;
  const panel = { p, conn, onChanged, onClose: () => setRound((n) => n + 1) };
  if (api) panel.api = api;
  if (projectsApi) panel.projectsApi = projectsApi;
  if (wait) panel.wait = wait;
  return (
    <section id={REPOSITORIES_ID} aria-label="Repositories" data-testid="connector-page-repositories" className="scroll-mt-6 flex min-w-0 flex-col gap-2">
      <h2 ref={heading} tabIndex={-1} className="text-[15px] font-bold text-axal-ink outline-none dark:text-gray-100">Repositories</h2>
      <div className="-mx-5">
        <GithubRepositoriesPanel key={round} {...panel} />
      </div>
    </section>
  );
}
