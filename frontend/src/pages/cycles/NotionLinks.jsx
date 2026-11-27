/**
 * D1088 (#2953) — "Link to [existing]?" under From Notion on a fact module
 * (Product roadmap, Prototype / MVP): a Notion row that looks like an item
 * already here waits instead of becoming a second row (#2405 § Module map,
 * rule 4). Accept links the two, so Notion's changes update the item and
 * nothing new is added. A row another connection feeds is named and is never
 * linked: it has Dismiss only. Dismissed stays dismissed until it changes in
 * Notion.
 */
const PROVIDERS = { github: 'GitHub', google_workspace: 'Google Workspace', google: 'Google Workspace' };

/** Whose row it is, in words; null when nobody else feeds it. */
export const fedByName = (key) => (!key ? null : PROVIDERS[key] || 'another connection');

export default function NotionLinks({ proposals, label, canAct, busy, onDecide }) {
  const links = (proposals || []).filter((p) => p.kind === 'fact_link');
  const pending = links.filter((p) => p.status === 'pending');
  const dismissed = links.length - pending.length;
  if (!links.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="notion-links">
      {pending.map((p) => {
        const existing = p.link?.existing || 'an item already here';
        const fedBy = fedByName(p.link?.fed_by);
        return (
          <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`notion-link-${p.id}`}>
            <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
              {fedBy ? `Already fed by ${fedBy}` : `Link to “${existing}”?`}
            </p>
            <p className="m-0 text-[12px] text-axal-ink/80 dark:text-gray-300" data-testid={`notion-link-line-${p.id}`}>
              {fedBy
                ? `“${p.title}” in Notion looks like “${existing}”, which ${fedBy} feeds. It is not imported.`
                : `“${p.title}” in Notion looks like “${existing}”, already in ${label || 'this module'}. Linking them lets Notion's changes update it; nothing new is added.`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className={LINK}>Open in Notion</a>}
              {canAct && p.mine && (
                <>
                  {!fedBy && <button type="button" className={PRIMARY} disabled={busy === p.id} onClick={() => onDecide(p, 'accept')} data-testid={`notion-link-accept-${p.id}`}>Link</button>}
                  <button type="button" className={LINK} disabled={busy === p.id} onClick={() => onDecide(p, 'dismiss')} data-testid={`notion-link-dismiss-${p.id}`}>Dismiss</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {dismissed > 0 && (
        <p className={MUTED} data-testid="notion-links-dismissed">
          {dismissed} {dismissed === 1 ? 'look-alike stays' : 'look-alikes stay'} out until {dismissed === 1 ? 'it changes' : 'they change'} in Notion.
        </p>
      )}
    </div>
  );
}

const MUTED = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
