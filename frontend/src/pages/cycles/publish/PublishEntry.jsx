import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publishApi } from '../../../lib/api/publish.js';
import PublishSheet from './PublishSheet.jsx';
import { accountOn, dayAndTime, historyHref, viewLink } from './publishModel.js';
import { BTN, BTN_PRIMARY, BTN_SECONDARY, Dialog, LAV_BOX, LINK, MUTED, StatusPill, Tile } from './SendParts.jsx';

/**
 * D1321 (#3482, follow-up) — where a Grow page opens Publish to…, on part 2's
 * gate (D1333's `publishPart`: the overview's `publish`, each module's
 * `parts.publish`, a sent update's `GET /portfolio-updates/:uid/publish`).
 *
 *   · `PublishTo`: the header's "Publish to…" (PUB1). It opens the sheet,
 *     pre-filled from the page's records, when `can_publish`; with nothing
 *     switched on (`empty.kind === 'connect'`) it opens PUB8's "Connect a
 *     place to publish". Anyone else gets no button.
 *   · `PublishedFromHere`: under the header, PUB8's other states (only the
 *     founder publishes; a support session) and the page's last three sends,
 *     for the venture's team, with the way to Published outside.
 *   · `PublishUpdate`: Publish to… on a sent update. It reads that update's
 *     gate when pressed, and opens the sheet on a draft made from the update's
 *     network version.
 */

const BTN_ON = `${BTN} border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25`;
const MODULE_OF = (part, module) => part?.module || module;

/** PUB8, left: nothing switched on yet. Publishing waits for a place the founder connects and turns on. */
export function ConnectDialog({ sentence, onClose }) {
  return (
    <Dialog title="Connect a place to publish" width={520} onCancel={onClose} testId="publish-connect" actions={(<>
      <button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button>
      <Link to="/account/connectors" className={BTN_PRIMARY} data-testid="publish-connect-open">Open Connectors</Link>
    </>)}>
      <p className={`m-0 text-[13px] ${MUTED}`}>
        Publish to… sends what you choose to a place you connect. Connect one first, then turn publishing on for this company on its connector page. Nothing is posted until you confirm it.
      </p>
      {sentence && sentence !== 'Connect a place to publish' && <p className="m-0 text-[12.5px]">{sentence}</p>}
    </Dialog>
  );
}

/** The header's Publish to…, or nothing. */
export function PublishTo({ part, projectId, module, api = publishApi, delay }) {
  const [open, setOpen] = useState(null);
  if (!part || part.state !== 'ok' || !projectId) return null;
  const connect = !part.can_publish && part.empty?.kind === 'connect';
  if (!part.can_publish && !connect) return null;
  return (
    <>
      <button type="button" className={BTN_ON} aria-haspopup="dialog" onClick={() => setOpen(connect ? 'connect' : 'sheet')} data-testid="publish-to">Publish to…</button>
      {open === 'connect' && <ConnectDialog sentence={part.empty?.sentence} onClose={() => setOpen(null)} />}
      {open === 'sheet' && <PublishSheet projectId={projectId} module={MODULE_OF(part, module)} start={{ kind: 'module' }} api={api} delay={delay} onClose={() => setOpen(null)} />}
    </>
  );
}

/** PUB8's other states and "Published from here", drawn under the header. */
export function PublishedFromHere({ part }) {
  if (!part) return null;
  if (part.state === 'unreadable') {
    return <p className={`m-0 text-[12.5px] ${MUTED}`} role="status" data-testid="publish-gate-unreadable">{part.reason || 'Publishing could not be read for this page.'}</p>;
  }
  const empty = part.empty;
  const locked = empty && (empty.kind === 'founder_only' || empty.kind === 'support');
  const recent = Array.isArray(part.recent) ? part.recent : [];
  if (!locked && !recent.length) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-label="Publishing" data-testid="published-from-here">
      {locked && (
        <div className={`${LAV_BOX} flex items-start gap-2.5`} data-testid={`publish-empty-${empty.kind}`}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none text-violet-700 dark:text-violet-300"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <div className="min-w-0">
            <div className="font-bold">{empty.sentence}</div>
            {empty.kind === 'founder_only' && <div className={`mt-0.5 ${MUTED}`}>You can read what was published in Updates › Published outside.</div>}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-axal-hairline bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-900" data-testid="published-recent">
          <div className="flex items-baseline gap-2">
            <h2 className="m-0 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Published from here</h2>
            <span className={`font-mono text-[11.5px] ${MUTED}`}>{recent.length}</span>
          </div>
          <ul className="m-0 list-none p-0">
            {recent.map((s) => {
              const link = viewLink({ ...s, retract: null });
              const when = dayAndTime(s.sent_at);
              return (
                <li key={s.uid} className="flex min-h-[44px] flex-wrap items-center gap-2.5 border-t border-axal-hairline py-1 text-[12.5px] first:border-t-0 dark:border-gray-800" data-testid={`published-recent-${s.uid}`}>
                  <Tile provider={s.provider_key} size={20} />
                  <span className="min-w-0 flex-1 truncate font-semibold text-axal-ink dark:text-gray-100">{accountOn(s.destination, s.provider_key)}</span>
                  {when.day && <span className={`font-mono text-[11.5px] ${MUTED}`}>{when.day}</span>}
                  <StatusPill status={s.status} />
                  {link && <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>{link.label}</a>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link to={historyHref()} className={LINK} data-testid="publish-open-outside">Open Published outside ›</Link>
    </section>
  );
}

/** Publish to… on a sent update: its own gate, read when pressed. A report or an unsent update says why. */
export function PublishUpdate({ updateUid, projectId, api = publishApi }) {
  const [state, setState] = useState(null);
  useEffect(() => { setState(null); }, [updateUid]);
  if (!updateUid || !projectId) return null;
  const press = async () => {
    setState({ kind: 'reading' });
    try {
      const r = await api.updateGate(updateUid);
      const p = r?.publish;
      if (p?.can_publish) setState({ kind: 'sheet' });
      else if (p?.empty?.kind === 'connect') setState({ kind: 'connect', sentence: p.empty.sentence });
      else setState({ kind: 'note', text: p?.empty?.sentence || p?.reason || 'This update cannot be published from here.' });
    } catch (e) {
      setState({ kind: 'note', text: e?.message || 'This update cannot be published from here.' });
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={`${BTN_ON} min-h-[36px] px-3 text-[12px]`} onClick={press} disabled={state?.kind === 'reading'} aria-haspopup="dialog" data-testid={`publish-update-${updateUid}`}>Publish to…</button>
      {state?.kind === 'note' && <span role="status" className={`text-[12px] ${MUTED}`} data-testid={`publish-update-note-${updateUid}`}>{state.text}</span>}
      {state?.kind === 'connect' && <ConnectDialog sentence={state.sentence} onClose={() => setState(null)} />}
      {state?.kind === 'sheet' && <PublishSheet projectId={projectId} module="updates" start={{ kind: 'update', uid: updateUid }} api={api} onClose={() => setState(null)} />}
    </span>
  );
}

