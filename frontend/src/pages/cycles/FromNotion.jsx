import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { notionApi } from '../../lib/api/notion';
import Lightbox from '../../ui/Lightbox';
import { cellText, day, errorSentence, skippedSentence, syncSummary } from '../account/notionModel';
import NotionLinks from './NotionLinks';

/**
 * D1086 (#2951, #2405 part 2) — a module's "From Notion" part, shared by every
 * module Notion feeds (parts 3–6 mount it). It reads
 * `GET /api/cycles/:section/notion?project&module` and draws:
 *   - the source line, "“Roadmap 2027” · From Notion, as of 2026-10-21", with
 *     Open in Notion, Choose from Notion (the connector page) and Sync from
 *     Notion, which reads only when pressed;
 *   - a fact module's rows, each with Delete, asked first in an in-page
 *     dialog: a deleted row stays deleted when Notion is synced again;
 *   - a proposal module's items, each with Accept and Dismiss, and "Changed
 *     in Notion" when its text changed after it was dismissed or proposed;
 *   - the states: loading, empty, not connected, partly synced (with the rows
 *     not read and why), unreadable (the rows already read kept below), and
 *     a read that failed, with Try again.
 *
 * A cell empty in Notion draws "—" with the footer saying why; never a zero.
 * Page text is drawn as text. Only the person whose Notion it is may sync,
 * delete, accept or dismiss; anyone else who can open the venture reads.
 *
 * On a phone the part starts collapsed to one line: "Roadmap 2027 · 6 rows ·
 * as of 2026-10-21".
 */
export default function FromNotion({ section, projectId, module, api = notionApi, phone = false, notionHref = '/account/connectors/notion#notion-sources', acceptDialog: AcceptDialog = null }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(null);
  const [note, setNote] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);
  // D1087: a kind whose Accept needs the founder's answers (an interview's consent) opens its own dialog first.
  const [accepting, setAccepting] = useState(null);
  const [open, setOpen] = useState(!phone);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: r.data ? 'refreshing' : 'loading' }));
    api.fromNotion(section, projectId, module).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      () => { if (live) setRead((r) => ({ status: r.data ? 'ready' : 'unreadable', data: r.data })); },
    );
    return () => { live = false; };
  }, [api, section, projectId, module, round]);
  const again = useCallback(() => setRound((n) => n + 1), []);

  const d = read.data;
  const sources = (d?.sources || []).filter((s) => s.module === module || !s.module);
  const active = sources.filter((s) => s.status === 'active');
  const stopped = sources.filter((s) => s.status === 'removed');
  const first = active[0] || null;
  const title = first?.title || 'your Notion page';
  const facts = Array.isArray(d?.facts) ? d.facts : [];
  const proposals = Array.isArray(d?.proposals) ? d.proposals : [];
  const fields = Array.isArray(d?.fields) ? d.fields : [];
  const asOf = day(first?.last_synced_at);
  const canAct = !!d?.can_sync;

  const sync = async () => {
    setSyncing(true); setNote(null);
    try { const r = await api.sync(section, projectId); setSynced(r); setNote({ tone: 'ok', text: syncSummary(r) }); again(); } catch (e) { setNote({ tone: 'bad', text: errorSentence(e) }); }
    setSyncing(false);
  };
  const decide = async (p, how) => {
    if (how === 'accept' && AcceptDialog) { setAccepting(p); return; }
    setBusy(p.id); setNote(null);
    try { await (how === 'accept' ? api.accept(section, projectId, p.id) : api.dismiss(section, projectId, p.id)); again(); } catch (e) { setNote({ tone: 'bad', text: errorSentence(e) }); }
    setBusy(null);
  };

  const frame = (body) => (
    <section id="from-notion" aria-labelledby="from-notion-title" data-testid="cycle-part-notion"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-notion-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
          {first ? <>“{title}” <span className="font-normal text-axal-muted dark:text-gray-400">· From Notion{asOf ? `, as of ${asOf}` : ', not read yet'}</span></> : 'From Notion'}
        </h2>
        {first && (
          <div className="flex flex-wrap items-center gap-2">
            {first.url && <a href={first.url} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="notion-open">Open in Notion</a>}
            {canAct && <Link to={notionHref} className={LINK} data-testid="notion-choose">Choose from Notion</Link>}
            {canAct && <button type="button" className={PRIMARY} onClick={sync} disabled={syncing} data-testid="notion-sync">{syncing ? 'Syncing…' : 'Sync from Notion'}</button>}
          </div>
        )}
      </div>
      {body}
    </section>
  );

  if (read.status === 'loading') return frame(<p className={MUTED} role="status" data-testid="notion-loading">Reading Notion…</p>);
  if (read.status === 'unreadable') {
    return frame(
      <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-read-unreadable">
        From Notion could not be read.{' '}<button type="button" className={LINK} onClick={again} data-testid="notion-read-retry">Try again</button>
      </p>,
    );
  }
  if (!active.length && !facts.length && !proposals.length) {
    if (!d?.connected) {
      return frame(
        <div className="flex flex-col items-start gap-1" data-testid="notion-not-connected">
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">Notion is not connected yet</p>
          <p className={MUTED}>Connect your Notion workspace, then share the pages this module should read.</p>
          <Link to="/account/connectors/notion" className={LINK} data-testid="notion-connect">Open the Notion page ›</Link>
        </div>,
      );
    }
    return frame(
      <div className="flex flex-col items-start gap-1" data-testid="notion-empty">
        <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">No Notion pages chosen for this module yet.</p>
        <p className={MUTED}>Axal VC opens only the pages you share.</p>
        {canAct && <Link to={notionHref} className={PRIMARY} data-testid="notion-empty-choose">Choose from Notion</Link>}
      </div>,
    );
  }

  const count = d?.lands === 'proposal' ? proposals.filter((p) => p.status === 'pending').length : facts.length;
  const unit = d?.lands === 'proposal' ? 'to review' : count === 1 ? 'row' : 'rows';
  if (phone && !open) {
    return frame(
      <button type="button" className="text-left text-[12.5px] text-axal-ink dark:text-gray-200" onClick={() => setOpen(true)} aria-expanded="false" data-testid="notion-collapsed">
        {first?.title || 'From Notion'} · {count} {unit}{asOf ? ` · as of ${asOf}` : ''}
      </button>,
    );
  }

  const live = new Map((synced?.sources || []).map((s) => [s.uid, s]));
  return frame(
    <>
      {note && <p className={`m-0 text-[12.5px] ${note.tone === 'bad' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} role={note.tone === 'bad' ? 'alert' : 'status'} data-testid="notion-note">{note.text}</p>}
      {syncing && <p className={MUTED} role="status" data-testid="notion-reading">Reading “{title}”…</p>}
      {synced?.more && !syncing && (
        <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-200" data-testid="notion-more">
          Notion has more to read than one sync takes. The rows below are current so far.{' '}
          {canAct && <button type="button" className={LINK} onClick={sync} data-testid="notion-more-again">Sync again</button>}
        </p>
      )}
      {active.map((s) => <SourceState key={s.uid} s={s} live={live.get(s.uid)} fields={fields} canAct={canAct} onSync={sync} notionHref={notionHref} />)}
      {stopped.map((s) => (
        <p key={s.uid} className={MUTED} data-testid={`notion-stopped-${s.uid}`}>“{s.title || 'A Notion page'}” is no longer synced. The rows already read stay below.</p>
      ))}
      {d?.lands === 'fact' && !d?.writer_ready && (
        <p className={MUTED} data-testid="notion-no-writer">{d?.label || 'This module'} does not take rows from Notion yet.</p>
      )}
      {d?.lands === 'fact' && facts.length > 0 && (
        <Facts facts={facts} fields={fields} canAct={canAct} onDelete={setDeleting} phone={phone} />
      )}
      {d?.lands === 'fact' && <FactsFooter facts={facts} fields={fields} keptDeleted={Number(d?.kept_deleted) || 0} />}
      {d?.lands === 'fact' && <NotionLinks proposals={proposals} label={d?.label} canAct={canAct} busy={busy} onDecide={decide} />}
      {d?.lands === 'proposal' && <Proposals proposals={proposals} canAct={canAct} busy={busy} onDecide={decide} />}
      {phone && <button type="button" className={`${LINK} self-start`} onClick={() => setOpen(false)} aria-expanded="true">Show less</button>}
      {accepting && AcceptDialog && (
        <AcceptDialog proposal={accepting} onClose={() => setAccepting(null)}
          onAccept={async (extra) => { await api.accept(section, projectId, accepting.id, extra); setAccepting(null); setNote({ tone: 'ok', text: 'Accepted.' }); again(); }} />
      )}
      {deleting && (
        <DeleteRow fact={deleting} fields={fields} label={d?.label || 'this module'} sourceTitle={first?.title || null}
          onClose={() => setDeleting(null)}
          onDelete={async () => { await api.deleteFact(section, projectId, deleting.ledger_id); setDeleting(null); again(); }} />
      )}
    </>,
  );
}

/** One source's last outcome: partly synced, unreadable, or nothing to say. A live sync's answer wins over the stored one. */
function SourceState({ s, live, fields, canAct, onSync, notionHref }) {
  const result = live?.result || s.last_result;
  const counts = live?.counts || s.last_counts;
  const title = s.title || 'your Notion page';
  if (result === 'partial' && counts) {
    const skipped = Array.isArray(counts.skipped) ? counts.skipped : [];
    const missed = skipped.reduce((n, x) => n + (Number(x.rows) || 0), 0);
    const total = Number(counts.read) || 0;
    const took = Math.max(0, total - missed);
    return (
      <div className={WARN} data-testid={`notion-partial-${s.uid}`}>
        <p className="m-0 font-semibold">Partly synced: {took} of {total} rows read.</p>
        {skipped.map((x) => <p key={`${x.reason}:${x.field}`} className="m-0">{skippedSentence(x, fields, title)}</p>)}
        <p className="m-0">The {took} {took === 1 ? 'row' : 'rows'} below {took === 1 ? 'is' : 'are'} current.{' '}
          {canAct && <button type="button" className={LINK} onClick={onSync} data-testid={`notion-partial-again-${s.uid}`}>Sync again</button>}
        </p>
      </div>
    );
  }
  if (result === 'unreadable') {
    const why = live?.reason === 'unauthorized' ? 'Notion asked you to sign in again.'
      : live?.reason === 'rate_limited' ? 'Notion is busy. Try again in a minute.'
        : 'Notion says the page was moved, or it is no longer shared with Axal VC.';
    const when = day(s.last_synced_at);
    return (
      <div className={BAD} role="alert" data-testid={`notion-unreadable-${s.uid}`}>
        <p className="m-0 font-semibold">We could not read “{title}”.</p>
        <p className="m-0">{why} The rows already read{when ? ` by ${when}` : ''} are kept below.</p>
        {canAct && <Link to={notionHref} className={LINK} data-testid={`notion-choose-again-${s.uid}`}>Choose again</Link>}
      </div>
    );
  }
  return null;
}

function Cell({ v }) {
  const t = cellText(v);
  return t == null ? <span className="text-axal-faint dark:text-gray-500" title="Empty in Notion">—</span> : <span className="break-words">{t}</span>;
}

function Facts({ facts, fields, canAct, onDelete, phone }) {
  if (phone) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="notion-facts">
        {facts.map((f) => (
          <li key={f.ledger_id} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 text-[12.5px] dark:border-gray-800" data-testid={`notion-fact-${f.ledger_id}`}>
            {f.values ? fields.map((x) => <span key={x.key}><span className="text-axal-muted dark:text-gray-400">{x.label}: </span><Cell v={f.values[x.key]} /></span>) : <NotRead />}
            <span className="text-[11px] text-axal-faint dark:text-gray-500">Last read {day(f.as_of) || 'not recorded'}</span>
            {canAct && f.mine && <button type="button" className={`${LINK} self-start`} onClick={() => onDelete(f)} data-testid={`notion-fact-delete-${f.ledger_id}`}>Delete</button>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12.5px]" data-testid="notion-facts">
        <thead><tr>{[...fields.map((x) => x.label), ''].map((h, i) => <th key={h || `a${i}`} scope="col" className={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {facts.map((f) => (
            <tr key={f.ledger_id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`notion-fact-${f.ledger_id}`}>
              {f.values ? fields.map((x) => <td key={x.key} className={TD}><Cell v={f.values[x.key]} /></td>) : <td className={TD} colSpan={fields.length}><NotRead /></td>}
              <td className={`${TD} text-right`}>
                {canAct && f.mine && <button type="button" className={LINK} onClick={() => onDelete(f)} data-testid={`notion-fact-delete-${f.ledger_id}`}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NotRead = () => <span className="text-axal-faint dark:text-gray-500">Not recorded: this module does not show its rows here yet.</span>;

/** "2 rows you deleted stay deleted." and why a "—" is drawn, naming the first field with one. */
function FactsFooter({ facts, fields, keptDeleted }) {
  const empty = fields.find((x) => facts.some((f) => f.values && cellText(f.values[x.key]) == null));
  if (!keptDeleted && !empty) return null;
  return (
    <p className={MUTED} data-testid="notion-facts-footer">
      {keptDeleted > 0 && `${keptDeleted} ${keptDeleted === 1 ? 'row you deleted stays' : 'rows you deleted stay'} deleted. `}
      {empty && `The “—” under ${empty.label} means the ${empty.label} value is empty in the database, so nothing was recorded.`}
    </p>
  );
}

function Proposals({ proposals, canAct, busy, onDecide }) {
  const pending = proposals.filter((p) => p.status === 'pending');
  const dismissed = proposals.filter((p) => p.status === 'dismissed');
  return (
    <div className="flex flex-col gap-2" data-testid="notion-proposals">
      {pending.length === 0 && <p className={MUTED} data-testid="notion-proposals-none">Nothing from Notion waits for you.</p>}
      {pending.map((p) => (
        <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`notion-proposal-${p.id}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{p.title}</p>
            {p.changed && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" data-testid={`notion-proposal-changed-${p.id}`}>Changed in Notion</span>}
          </div>
          {p.extract && <p className="m-0 line-clamp-3 whitespace-pre-line text-[12px] text-axal-ink/80 dark:text-gray-300">{p.extract}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className={LINK}>Open in Notion</a>}
            {canAct && p.mine && (
              <>
                <button type="button" className={PRIMARY} disabled={busy === p.id} onClick={() => onDecide(p, 'accept')} data-testid={`notion-accept-${p.id}`}>Accept</button>
                <button type="button" className={LINK} disabled={busy === p.id} onClick={() => onDecide(p, 'dismiss')} data-testid={`notion-dismiss-${p.id}`}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      ))}
      {dismissed.length > 0 && (
        <p className={MUTED} data-testid="notion-dismissed">
          {dismissed.length} dismissed {dismissed.length === 1 ? 'item stays' : 'items stay'} dismissed until {dismissed.length === 1 ? 'it changes' : 'they change'} in Notion.
        </p>
      )}
    </div>
  );
}

/** Delete, asked first: the row leaves the module and stays deleted on the next sync; Notion is not changed. */
function DeleteRow({ fact, fields, label, sourceTitle, onClose, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = cellText(fact.values?.[fields[0]?.key]) || 'This row';
  const go = async () => {
    setBusy(true); setError(null);
    try { await onDelete(); } catch (e) { setError(errorSentence(e, 'The row could not be deleted. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label="Delete this row?" title="Delete this row?" onClose={onClose} width={440} testId="notion-delete-dialog" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Keep it</button>
          <button type="button" className={DANGER} onClick={go} disabled={busy} data-testid="notion-delete-confirm">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px] text-axal-ink dark:text-gray-200">
        <p className="m-0">“{name}” leaves {label}. It stays deleted when you sync again.</p>
        <p className={MUTED}>{sourceTitle ? `“${sourceTitle}”` : 'The page'} in Notion is not changed.</p>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-delete-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

const MUTED = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
const DANGER = 'inline-flex items-center justify-center rounded-axal-sm bg-red-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 dark:hover:bg-red-500 max-sm:min-h-[44px]';
const WARN = 'flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
const BAD = 'flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const TH = 'px-3 py-2 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top';
