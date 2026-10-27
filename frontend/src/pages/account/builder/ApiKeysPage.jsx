/**
 * D1317 (#2480) — Account › Builder › API keys at `/account/builder/keys`, and
 * one key's drawer at `/account/builder/keys/:uid` (APIK1, APIK4, APIK5,
 * APIK8–APIK15), on D841's reads and writes (`lib/api/developerKeys.js`) and
 * D845's per-key month (`lib/api/developerUsage.js`).
 *
 * THE SECRET lives in this component's `reveal` state only, from the 201 of a
 * create or rotate, and only while the reveal dialog is open. It is dropped on
 * Done, on close, when the drawer address changes and on unmount. The list is
 * re-read after every write, so a key's state is the Worker's, never a guess.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { developerKeysApi } from '../../../lib/api/developerKeys.js';
import { developerUsageApi } from '../../../lib/api/developerUsage.js';
import { BTN, INPUT, useAccountRead } from '../AccountCenter';
import { BUILDER_ROOT, builderPathFor } from './builderModel';
import { CreateDialog, EditDialog, RevealDialog, RevokeDialog, RotateDialog } from './ApiKeyDialogs';
import {
  FILTERS, REFUSED_CALLS, SORTS, WORDS, canCreate, cardFor, companiesCell, dayOf, dayTimeOf, filterCounts, keyState,
  monthOf, previewOf, replacementForm, rowsOf, scopeOf, supportNotice,
} from './apiKeysModel';

const CARD = 'rounded-axal-lg border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const EYEBROW = 'font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  soon: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  expired: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  revoked: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const KEYS_PATH = `${BUILDER_ROOT}/keys`;

export function StatePill({ keyView, now }) {
  const s = keyState(keyView, now);
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-axal-pill border px-2 py-0.5 text-[11.5px] font-semibold ${PILL[s.id]}`} data-testid="apik-state"><span aria-hidden="true">{s.icon}</span>{s.word}</span>;
}

function Chip({ children, write = false }) {
  return <span className="inline-flex items-center gap-1 rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">{children}{write && <span className="text-[10px] font-bold text-amber-900 dark:text-amber-200">Write</span>}</span>;
}

/** A thin meter for this month's AI tokens against a key's own limit; a dashed hairline when there is nothing to read. */
function Meter({ m }) {
  if (!m.read) return <span className={`text-[12px] ${MUTED}`} title={WORDS.notMeteredWhy}>{WORDS.notMetered}</span>;
  if (!m.limit) return <span className={`text-[12px] ${MUTED}`}>{WORDS.noLimit}{m.used ? <> · <span className={MONO}>{m.used}</span></> : <> · {WORDS.noCall}</>}</span>;
  return (
    <span className="flex min-w-[110px] flex-col gap-1">
      <span className={`${MONO} text-[12px] text-axal-ink dark:text-gray-100`}>{m.used ?? '—'} of {m.limit}</span>
      {m.pct == null
        ? <span className="block h-1 rounded-full border-t border-dashed border-gray-300 dark:border-gray-600" aria-hidden="true" />
        : <span className="block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="meter" aria-label="AI tokens this month" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pct}><span className="block h-full bg-axal-violet" style={{ width: `${m.pct}%` }} /></span>}
    </span>
  );
}

function Message({ title, line, children, bad = false, testId }) {
  return (
    <section className={`${bad ? 'rounded-axal-lg border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40' : CARD} flex flex-col items-start gap-2`} data-testid={testId}>
      <h3 className={bad ? 'm-0 text-[15px] font-extrabold tracking-axal-heading text-red-800 dark:text-red-200' : H3}>{title}</h3>
      {line && <p className={`m-0 text-[13px] ${MUTED}`}>{line}</p>}
      {children}
    </section>
  );
}

/** Card 2: how to call with a key, the limits in force (D849), and what a refusal returns (APIK15). */
function HowToUse({ limits }) {
  const [open, setOpen] = useState(false);
  const perKey = limits.data?.keys?.[0]?.rate_per_minute;
  const perMember = limits.data?.member?.calls_per_minute;
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="apik-how">
      <h3 className={H3}>How to use a key</h3>
      <pre className={`m-0 overflow-x-auto rounded-axal-md bg-gray-50 p-3 text-[12px] text-axal-ink dark:bg-gray-800 dark:text-gray-100 ${MONO}`}>{'POST https://axal.vc/mcp\nAuthorization: Bearer axk_[your key]'}</pre>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="apik-limits">
        {limits.status === 'ready' && perMember
          ? <>Limits: <span className={MONO}>{perKey ?? 60}</span> calls a minute per key, <span className={MONO}>{perMember}</span> across all your keys and assistants.</>
          : limits.status === 'loading' ? 'Reading the limits…' : 'Limits: not recorded here. They could not be read.'}
      </p>
      <button type="button" className={`${BTN.link} w-fit`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="apik-refusals-toggle">What a refused call returns {open ? '▴' : '▾'}</button>
      {open && (
        <div className="flex flex-col gap-2" data-testid="apik-refusals">
          <table className="w-full text-left text-[12.5px]">
            <tbody>{REFUSED_CALLS.map(([code, id, words]) => (
              <tr key={id} className="border-t border-axal-hairline dark:border-gray-800">
                <td className={`${MONO} py-1.5 pr-3 text-axal-ink dark:text-gray-100`}>{code} {id}</td>
                <td className={`py-1.5 ${MUTED}`}>{words}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.refusalLine}</p>
        </div>
      )}
      <Link to={builderPathFor({ page: 'usage' })} className={`${BTN.link} w-fit`}>See API usage ›</Link>
    </section>
  );
}

/** APIK5: one key. A uid that is not the member's draws only "not on your account" (APIK14), whether or not it exists. */
function KeyDrawer({ uid, read, usage, usageApi, support, onClose, onRotate, onRevoke, onEdit, now }) {
  const key = (read?.keys ?? []).find((k) => k.uid === uid) ?? null;
  const recent = useAccountRead(() => usageApi.events({ key: uid }), { enabled: !!key });
  const title = key ? key.name : 'API key';
  const live = key ? keyState(key, now).live : false;
  const m = key ? monthOf(key, usage) : null;
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={560} phone="full" testId="apik-drawer"
      footer={key && live && !support ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={BTN.link} onClick={() => onEdit(key)} data-testid="apik-drawer-edit">Edit name and limit</button>
          <span className="flex gap-2">
            <button type="button" className={BTN.ghost} onClick={() => onRotate(key)} data-testid="apik-drawer-rotate">Rotate</button>
            <button type="button" className={BTN.danger} onClick={() => onRevoke(key)} data-testid="apik-drawer-revoke">Revoke</button>
          </span>
        </div>
      ) : null}>
      <button type="button" className={`${BTN.link} mb-3 w-fit`} onClick={onClose} data-testid="apik-drawer-back">‹ API keys</button>
      {!key ? (
        <div className="flex flex-col gap-2" data-testid="apik-foreign">
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{WORDS.foreign}</p>
          <button type="button" className={`${BTN.link} w-fit`} onClick={onClose}>Back to API keys</button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-[13px] text-axal-ink dark:text-gray-100">
          <div><StatePill keyView={key} now={now} /></div>
          <div className="flex flex-col gap-1"><span className={EYEBROW}>Key</span>
            <span className={`${MONO} ${key.revoked_at ? 'line-through' : ''}`} data-testid="apik-drawer-preview">{previewOf(key)}</span>
            <span className={`text-[12px] ${MUTED}`}>The secret was shown once{dayOf(key.created_at) ? ` on ${dayOf(key.created_at)}` : ''}.</span></div>
          <div className="flex flex-col gap-1.5"><span className={EYEBROW}>Reaches</span>
            {(key.companies ?? []).map((c) => (
              <span key={c.id} className="flex flex-wrap items-center gap-2" data-testid={`apik-reach-${c.id}`}>{c.name || `Company ${c.id}`}
                {c.still_owned === false
                  ? <span className="rounded-axal-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{WORDS.lost}</span>
                  : <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">{WORDS.stillYours}</span>}
              </span>
            ))}
            <span className="flex flex-wrap gap-1.5">{(key.scopes ?? []).map((s) => { const o = scopeOf(read, s); return <Chip key={s} write={o.write}>{o.label}</Chip>; })}</span></div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className={EYEBROW}>Created</dt><dd className={`m-0 ${MONO}`}>{dayOf(key.created_at) ?? '—'}</dd>
            <dt className={EYEBROW}>Last used</dt><dd className={`m-0 ${MONO}`}>{dayTimeOf(key.last_used_at) ?? <span className={MUTED}>— {WORDS.noCall}</span>}</dd>
            <dt className={EYEBROW}>Expires</dt><dd className={`m-0 ${MONO}`}>{dayOf(key.expires_at) ?? <span className={MUTED}>— {WORDS.neverExpires}</span>}</dd>
          </dl>
          <div className="flex flex-col gap-1"><span className={EYEBROW}>AI tokens this month</span>
            <Meter m={m} />
            <span className={`text-[12px] ${MUTED}`}>{WORDS.resets}</span>
            <Link to={`${builderPathFor({ page: 'usage' })}?key=${encodeURIComponent(key.uid)}`} className={`${BTN.link} w-fit`}>See in API usage ›</Link></div>
          <div className="flex flex-col gap-1"><span className={EYEBROW}>Recent requests</span>
            {recent.status === 'loading' && <span className={MUTED}>Reading…</span>}
            {recent.status === 'unreadable' && <span className={MUTED} data-testid="apik-recent-unreadable">Recent requests could not be read. <button type="button" className={BTN.link} onClick={recent.reload}>Try again</button></span>}
            {recent.status === 'ready' && ((recent.data?.events ?? []).length === 0
              ? <span className={MUTED}>{WORDS.noCall}</span>
              : <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="apik-recent">{recent.data.events.slice(0, 5).map((e) => (
                <li key={e.execution_id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className={`${MONO} ${MUTED}`}>{dayTimeOf(e.created_at)}</span>
                  <span className={MONO}>{e.operation}</span>
                  <span className={`rounded-axal-pill border px-1.5 text-[11px] font-semibold ${e.outcome === 'ok' ? PILL.active : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'}`}>{e.outcome === 'ok' ? 'OK' : e.outcome.replace(/_/g, ' ')}</span>
                </li>
              ))}</ul>)}
            <Link to={`${builderPathFor({ page: 'activity' })}?key=${encodeURIComponent(key.uid)}`} className={`${BTN.link} w-fit`}>See all in Activity ›</Link></div>
          {live && <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.editLine}</p>}
        </div>
      )}
    </Lightbox>
  );
}

/**
 * The page. `api`, `usageApi`, `navigate` and `now` are the tests' seams; the
 * section passes the real ones. `support` is a support or view-as session: the
 * list shows, every write is left out (APIK14). `role` picks APIK9's cards.
 */
export default function ApiKeysPage({
  drawerUid = null, api = developerKeysApi, usageApi = developerUsageApi, support = false, who = null, role = null,
  navigate: nav = null, now = new Date(),
}) {
  const routerNavigate = useNavigate();
  const navigate = nav ?? routerNavigate;
  const keys = useAccountRead(() => api.list());
  const limits = useAccountRead(() => api.limits());
  const usage = useAccountRead(() => usageApi.keys({}), { enabled: keys.status === 'ready' && (keys.data?.keys ?? []).length > 0 });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(null);
  const [sort, setSort] = useState('last_used');
  const [dialog, setDialog] = useState(null); // { kind: 'create'|'rotate'|'revoke'|'edit', key?, initial? }
  const [reveal, setReveal] = useState(null); // { title, ok, old, secret, key } — the only home of a secret
  const [notice, setNotice] = useState(null);
  const [fresh, setFresh] = useState(null);

  // A secret never survives a change of address.
  useEffect(() => { setReveal(null); }, [drawerUid]);
  useEffect(() => () => setReveal(null), []);

  const read = keys.data;
  const card = keys.status === 'ready' ? cardFor({ read, role }) : keys.httpStatus === 404 ? 'off' : null;
  const rows = useMemo(() => rowsOf(read?.keys, { q, filter, sort }, now), [read, q, filter, sort, now]);
  const counts = filterCounts(read?.keys, now);
  const creatable = keys.status === 'ready' && canCreate(read, { support });
  const usageRead = usage.status === 'ready' ? usage.data : null;

  const closeDrawer = () => navigate(KEYS_PATH);
  const afterWrite = (line, uid = null) => { setNotice(line); setFresh(uid); keys.reload(); usage.reload(); };
  const doneReveal = () => {
    const r = reveal;
    setReveal(null);
    const name = r?.key?.name ?? 'The key';
    afterWrite(r?.created ? `${name} is ready. Its secret is no longer shown anywhere.` : `${name} was rotated. Its new secret is no longer shown anywhere.`, r?.key?.uid ?? null);
    // A rotate from the drawer moves to the new key's drawer once the secret is gone, never while it is shown.
    if (r?.next) navigate(builderPathFor({ drawer: { kind: 'key', id: r.next } }));
  };

  let body;
  if (keys.status === 'loading') {
    body = (
      <section className={`${CARD} flex flex-col gap-2`} data-testid="apik-loading">
        <h3 className={H3}>{WORDS.cardTitle}</h3>
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-8 animate-pulse rounded-axal-sm bg-gray-100 motion-reduce:animate-none dark:bg-gray-800" />)}
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{WORDS.loading} {WORDS.createWaits}</p>
      </section>
    );
  } else if (card === 'off') {
    body = <Message title={WORDS.off} line={WORDS.offLine} testId="apik-off"><Link to={builderPathFor({ page: 'services' })} className={BTN.link}>Open MCP and services ›</Link></Message>;
  } else if (keys.status === 'unreadable') {
    body = <Message title={WORDS.unreadable} line={WORDS.unreadableLine} bad testId="apik-unreadable"><button type="button" className={BTN.ghost} onClick={keys.reload}>Try again</button></Message>;
  } else if (card === 'explorer') {
    body = <Message title={WORDS.explorer} line={WORDS.explorerLine} testId="apik-explorer"><Link to="/onboarding" className={BTN.primary}>Set up your profile</Link></Message>;
  } else if (card === 'nothing') {
    body = (
      <Message title={WORDS.nothing} line={WORDS.nothingLine} testId="apik-nothing">
        {role === 'super_admin' && <><p className={`m-0 text-[12.5px] ${MUTED}`}>{WORDS.hq}</p><Link to="/admin/integration-keys" className={BTN.link}>Open Integration keys ›</Link></>}
      </Message>
    );
  } else if (card === 'empty') {
    body = (
      <Message title={WORDS.empty} line={WORDS.emptyLine} testId="apik-empty">
        <span className="flex flex-wrap items-center gap-3">
          {creatable && <button type="button" className={BTN.primary} onClick={() => setDialog({ kind: 'create' })} data-testid="apik-create-open">{WORDS.create}</button>}
          <Link to={builderPathFor({ page: 'services' })} className={BTN.link}>Connect an assistant ›</Link>
        </span>
      </Message>
    );
  } else {
    body = (
      <section className={`${CARD} flex flex-col gap-3`} data-testid="apik-list">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`${H3} flex-1`}>{WORDS.cardTitle}</h3>
          {creatable && <button type="button" className={BTN.primary} onClick={() => setDialog({ kind: 'create' })} data-testid="apik-create-open">{WORDS.create}</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" aria-label="Search keys" placeholder="Search keys" className={`${INPUT} max-w-[220px]`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="apik-search" />
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter((x) => (x === f.id ? null : f.id))} data-testid={`apik-filter-${f.id}`}
              className={`inline-flex min-h-[32px] items-center gap-1 rounded-axal-pill border px-3 text-[12px] font-semibold ${filter === f.id ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`}>
              {f.label} <span className={MONO}>{counts[f.id]}</span></button>
          ))}
          <label className={`ml-auto flex items-center gap-1.5 text-[12px] ${MUTED}`}>Sort
            <select className={`${INPUT} w-auto`} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="apik-sort">{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead><tr className={EYEBROW}>{['Name', 'Key', 'Companies', 'Permissions', 'Created', 'Last used', 'Expires', 'AI tokens', 'State', ''].map((h) => <th key={h} scope="col" className="pb-2 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((k) => {
                const s = keyState(k, now);
                const dead = !s.live;
                return (
                  <tr key={k.uid} className={`border-t border-axal-hairline align-top dark:border-gray-800 ${fresh === k.uid ? 'bg-axal-lavender dark:bg-violet-950/40' : ''} ${dead ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`} data-testid={`apik-row-${k.uid}`}>
                    <td className="py-2 pr-3 font-semibold"><Link to={builderPathFor({ drawer: { kind: 'key', id: k.uid } })} className="hover:underline">{k.name}</Link></td>
                    <td className={`py-2 pr-3 ${MONO} ${k.revoked_at ? 'line-through' : ''}`}>{previewOf(k)}</td>
                    <td className="py-2 pr-3">{companiesCell(k)}</td>
                    <td className="py-2 pr-3"><span className="flex flex-wrap gap-1">{(k.scopes ?? []).map((sc) => { const o = scopeOf(read, sc); return <Chip key={sc} write={o.write}>{o.label}</Chip>; })}</span></td>
                    <td className={`py-2 pr-3 ${MONO}`}>{dayOf(k.created_at) ?? '—'}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{dayTimeOf(k.last_used_at) ?? <span className={MUTED}>— {WORDS.noCall}</span>}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{s.id === 'revoked' ? '—' : dayOf(k.expires_at) ?? <span className={MUTED}>{WORDS.neverExpires}</span>}</td>
                    <td className="py-2 pr-3">{dead ? '—' : <Meter m={monthOf(k, usageRead)} />}</td>
                    <td className="py-2 pr-3"><StatePill keyView={k} now={now} />{s.id === 'revoked' && dayOf(k.revoked_at) && <span className={`block text-[11px] ${MUTED}`}>{dayOf(k.revoked_at)}</span>}</td>
                    <td className="py-2">
                      {!support && (s.live
                        ? <span className="flex gap-2"><button type="button" className={BTN.link} onClick={() => setDialog({ kind: 'rotate', key: k })} data-testid={`apik-rotate-${k.uid}`}>Rotate</button><button type="button" className={`${BTN.link} text-red-700 dark:text-red-300`} onClick={() => setDialog({ kind: 'revoke', key: k })} data-testid={`apik-revoke-${k.uid}`}>Revoke</button></span>
                        : s.id === 'expired' && creatable && <button type="button" className={BTN.link} onClick={() => setDialog({ kind: 'create', initial: replacementForm(k) })} data-testid={`apik-replace-${k.uid}`}>Create a replacement</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className={`m-0 py-3 text-[12.5px] ${MUTED}`}>No key matches.</p>}
        </div>
        <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.rule}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="apik-page">
      {support && <p role="status" className="m-0 rounded-axal-md border border-axal-hairline bg-gray-50 px-3 py-2 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid="apik-support">{supportNotice(who)}</p>}
      {notice && <p role="status" className="m-0 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="apik-notice">{notice}</p>}
      {body}
      {card !== 'off' && <HowToUse limits={limits} />}

      {drawerUid && keys.status === 'ready' && (
        <KeyDrawer uid={drawerUid} read={read} usage={usageRead} usageApi={usageApi} support={support} now={now} onClose={closeDrawer}
          onRotate={(k) => setDialog({ kind: 'rotate', key: k })} onRevoke={(k) => setDialog({ kind: 'revoke', key: k })} onEdit={(k) => setDialog({ kind: 'edit', key: k })} />
      )}
      {dialog?.kind === 'create' && !support && (
        <CreateDialog read={read} initial={dialog.initial} api={api} now={now} onClose={() => setDialog(null)}
          onCreated={(res) => { setDialog(null); setReveal({ title: 'Copy your key now', ok: `${res.key?.name ?? 'The key'} was created.`, old: null, secret: res.secret, key: res.key, created: true }); keys.reload(); }} />
      )}
      {dialog?.kind === 'rotate' && !support && (
        <RotateDialog keyView={dialog.key} api={api} onClose={() => setDialog(null)}
          onRotated={(res) => {
            setDialog(null);
            const at = dayTimeOf(res.replaced?.revoked_at);
            setReveal({
              title: 'Copy your new key', ok: `${res.key?.name ?? 'The key'} has a new secret.`,
              old: `The old key ${previewOf(dialog.key)} was revoked${at ? ` at ${at.split(' · ')[1]}` : ''}.`,
              secret: res.secret, key: res.key, created: false, next: drawerUid === dialog.key.uid ? res.key?.uid ?? null : null,
            });
            keys.reload();
          }} />
      )}
      {dialog?.kind === 'revoke' && !support && (
        <RevokeDialog keyView={dialog.key} api={api} onClose={() => setDialog(null)}
          onRevoked={(k) => { setDialog(null); afterWrite(`${k?.name ?? dialog.key.name} was revoked.`); }} />
      )}
      {dialog?.kind === 'edit' && !support && (
        <EditDialog keyView={dialog.key} api={api} onClose={() => setDialog(null)}
          onSaved={(k) => { setDialog(null); afterWrite(`${k?.name ?? dialog.key.name} was saved.`); }} />
      )}
      {reveal && (
        <RevealDialog title={reveal.title} okLine={reveal.ok} oldLine={reveal.old} secret={reveal.secret} keyView={reveal.key} onDone={doneReveal} />
      )}
    </div>
  );
}
