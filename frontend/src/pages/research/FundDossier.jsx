import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Field, StatedLimit } from '../advisor/expertise/kit';
import { NO_STORE, gapCount, missingChecklist, nothingToDraft, updatedAgo } from './fundDossierRead';
import FundReportsPanel from './FundReportsPanel';
import { createRecordGate, recordKey, sameRecord } from './recordGate.js';
import { useLeaveGuard } from '../../lib/leaveGuard.js';
import { CatalogueChooser, ConflictSheet, IdentityBand, PublicRecordCard } from './FundIdentity';
import {
  DRAFT_FIELDS, acceptWaitReason, combineNotes, dirtyFields, draftsFrom, leaveMessage, mergeDrafts,
} from './myFundsRead';

/**
 * `/research/funds/:uid` — one fund the founder has researched.
 *
 * THREE AXES, NEVER ONE. `stage_fit`, `path` and `status` are separate columns
 * and the selects edit them separately. A null stage is "not assessed", never
 * "wrong". A cold path is neutral, not a penalty. A pass with no reason is a
 * warning, not a blank.
 *
 * THE BRIEF IS DRAFTED FROM THIS ROW ALONE (D312). The `research/funds` draft
 * surface reads this one fund, owner-scoped, and marks every unrecorded fact
 * as a question to ask rather than a fact. It is never drafted on page load,
 * and not at all while the row holds neither a thesis nor a note — which the
 * band says before the press, its Draft button disabled with the reason
 * (D593), as well as after a 409. Accept appends it to `note`, after what is
 * already written; it does not email the fund. The local "approach note"
 * band it replaced put its own explanatory sentence into the note on Accept.
 *
 * D593 ALSO: a source recorded without http(s) is shown as written, not as
 * "no source URL"; an unassessed stage and a path other than warm are drawn
 * in muted ink on their tiles; and below lg a live fund's Pass reason card
 * is left out, as the phone canvas (M1) draws it.
 *
 * THE CHECKLIST COUNTS ONLY WHAT THIS PAGE CAN CLOSE. Rows derived from the
 * fund's columns are done or a gap. The canvas also draws a sourced
 * investment, a public size and the partner in the room; no store holds
 * those, so they read Not recorded with the reason and are not counted.
 *
 * A BLANK CHEQUE IS NOT ZERO. Empty inputs PATCH null. The overlap sentence is
 * the worker's `overlap_note`, which leaves an unrecorded end open and refuses
 * to print an overlap of 0 against a missing raise.
 *
 * D7168 (canvas D7033, FND-S02 to FND-S05). SAVING ONE FIELD NEVER DISCARDS
 * ANOTHER: each box has its own buffer, and a save refreshes the fields it
 * sent and the ones nobody is editing, so changing the stage keeps the note
 * being typed. Every write names the `updated_at` it read; a row changed
 * elsewhere answers 409 and the conflict Sheet compares both versions before
 * anything is overwritten. Leaving with unsaved text asks first. The identity
 * block says whether the entry is linked to a catalogue vehicle (Open
 * catalogue vehicle →), your own record, or a legacy entry, which opens the
 * chooser; the public record beside the private dossier is the catalogue's,
 * read-only. The cheque card runs two tests: the whole round, and an intended
 * allocation per fund. Write into the note waits while the note is unsaved,
 * then moves focus to the added text, and every save is announced.
 */

const STAGE = { right: 'Right stage', wrong: 'Wrong stage' };
const PATH = { warm: 'Warm path', cold: 'No route in' };
const STATUS = { researching: 'Researching', passed: 'Passed' };

const stageLabel = (v) => STAGE[v] || 'Stage not assessed';
const pathLabel = (v) => PATH[v] || 'Route not recorded';
const statusLabel = (v) => STATUS[v] || 'Researching';

/**
 * The Stage and Path tiles' ink, as the canvas draws it (D593): a read in its
 * own colour, and "Stage not assessed", "No route in" and "Route not
 * recorded" in muted ink — an absent or cold read is not a finding to
 * highlight. The pills above keep their own neutral tone.
 */
export const stageTileTone = (v) => (v === 'right' ? 'ok' : v === 'wrong' ? 'warn' : 'muted');
export const pathTileTone = (v) => (v === 'warm' ? 'ok' : 'muted');

/** The draft band's refusal, said before the press as well as after a 409. */
const NOTHING_TO_DRAFT = 'Record a thesis or a note first — there is nothing to draft from.';

const usd = (cents) => (cents == null
  ? null
  : `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`);

function chequeTile(lo, hi) {
  if (lo == null && hi == null) return { nr: true, sub: 'either end may be unknown' };
  if (lo != null && hi != null) return { v: `${usd(lo)}–${usd(hi)}`, sub: 'their range, in their terms' };
  if (lo != null) return { v: `${usd(lo)} and up`, sub: 'only the low end is recorded' };
  return { v: `up to ${usd(hi)}`, sub: 'only the high end is recorded' };
}

function parseDollars(text) {
  const raw = String(text ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return { cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Enter an amount like 500000, or leave the field blank.' };
  }
  return { cents: Math.round(Number(raw) * 100) };
}

function exampleHost(value) {
  try {
    const raw = new URL(String(value)).hostname.toLowerCase();
    const host = raw.endsWith('.') ? raw.slice(0, -1) : raw;
    return host === 'example.com' || host === 'www.example.com';
  } catch {
    return false;
  }
}

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const selectClass =
  'rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const primaryBtn =
  'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:opacity-70';

const ghostBtn =
  'rounded-lg border border-violet-200 px-3 py-1.5 text-[12px] font-semibold text-violet-800 '
  + 'hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950/40';

function Nr() {
  return (
    <span className="inline-flex rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      Not recorded
    </span>
  );
}

const TILE_INK = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-800 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-300',
  // The same muted ink as the tile's own sub-line, as the canvas draws both
  // in `t.muted`; #9ca3af on the dark card.
  muted: 'text-axal-muted dark:text-gray-400',
  // The dark pair is the one the app's skin already gives `text-axal-ink`.
  ink: 'text-axal-ink dark:text-gray-200',
};

export function Tile({ k, v, sub, nr, tone = 'ink' }) {
  const ink = TILE_INK[tone] || TILE_INK.ink;
  return (
    <Card>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><Nr /></div>
        : <div className={`mt-1.5 font-mono text-[17px] font-bold tracking-tight ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

/**
 * The header's source line (D593). Three cases, and the middle one was the
 * bug: a value recorded without http(s), such as "acme.vc", read "Not
 * recorded · no source URL on this row" — false, the row has one. It is now
 * shown as written, unlinked, with the reason. Only an http(s) value is a
 * link, and only a blank is Not recorded. example.com stays "placeholder".
 */
export function SourceLine({ value }) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Nr />
        <span className="text-[12px] text-axal-muted">no source URL on this row</span>
      </span>
    );
  }
  if (/^https?:\/\//i.test(text)) {
    return (
      <>
        <a href={text} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
          Their site →
        </a>
        <span className="ml-2 font-mono text-[10px] text-axal-muted">
          {text}{exampleHost(text) ? ' · placeholder' : ''}
        </span>
      </>
    );
  }
  return (
    <span data-testid="fund-dossier-source-unlinked" className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] text-axal-ink dark:text-gray-100">
        {text}{exampleHost(`https://${text}`) ? ' · placeholder' : ''}
      </span>
      <span className="text-[12px] text-axal-muted">recorded without http(s), so it is not linked</span>
    </span>
  );
}

/**
 * The Pass reason card's classes. A pass with no reason carries the red edge.
 * A live fund's card only says the field appears once it is Passed, so below
 * lg it is left out, as M1 draws the phone stack (D593); on lg and up it
 * stays, as before.
 */
export function passCardClass(fund) {
  if (fund?.status !== 'passed') return 'hidden lg:block';
  return fund.pass_reason ? '' : 'border-red-200 dark:border-red-800';
}

/** Hours and minutes, for "Note saved 14:07". */
const clock = (d = new Date()) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** What each draft field sends when saved, or an error sentence. */
function patchFor(key, drafts) {
  const text = drafts[key] ?? '';
  if (key === 'lo' || key === 'hi' || key === 'alloc') {
    const parsed = parseDollars(text);
    if (parsed.error) return { error: parsed.error };
    const column = key === 'lo' ? 'cheque_min_cents' : key === 'hi' ? 'cheque_max_cents' : 'intended_allocation_cents';
    return { patch: { [column]: parsed.cents } };
  }
  if (key === 'source_url') return { patch: { source_url: text.trim() } };
  return { patch: { [key]: text } };
}

const FIELD_NAME = { note: 'Note', thesis: 'Thesis', pass_reason: 'Pass reason', source_url: 'Source', lo: 'Cheque low end', hi: 'Cheque high end', alloc: 'Allocation' };
const DECISION_NAME = { stage_fit: 'Stage fit', path: 'Route in', status: 'Status' };

/** Whether the browser says it is online; true where there is no browser. */
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** One field's save state beside it: Unsaved, Saving…, saved at, or failed with the draft kept. */
function FieldState({ dirty, state }) {
  if (state?.phase === 'saving') return <Pill tone="neutral">Saving…</Pill>;
  if (state?.phase === 'failed') return <Pill tone="danger">Save failed · draft kept</Pill>;
  if (dirty) return <Pill tone="warn">Unsaved changes</Pill>;
  if (state?.phase === 'saved') return <Pill tone="ok">{`Saved ${state.at}`}</Pill>;
  return null;
}

export default function FundDossier({ role = 'founder' }) {
  const { uid } = useParams();
  const [fund, setFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // D7168: one buffer per field. A save refreshes the fields it sent and the
  // ones nobody is editing; unsaved text in any other box stays (FND-S04).
  const [drafts, setDrafts] = useState(() => draftsFrom(null));
  const setDraft = (key, value) => setDrafts((d) => ({ ...d, [key]: value }));
  const [fieldState, setFieldState] = useState({});
  const [editingThesis, setEditingThesis] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [conflict, setConflict] = useState(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const online = useOnline();
  const noteRef = useRef(null);
  const chooseRef = useRef(null);
  const identityRef = useRef(null);
  const fundRef = useRef(null);
  const showFund = (row) => { fundRef.current = row; setFund(row); };

  // D4607: the fund this page loaded, by its route identity. A read or a
  // write that answers after the route has moved to another fund is dropped,
  // and writes go to the loaded fund only while the route still names it.
  const routeKey = recordKey(uid);
  const route = useRef(routeKey);
  route.current = routeKey;
  const [loadedKey, setLoadedKey] = useState(null);
  const gate = useRef(null);
  if (!gate.current) gate.current = createRecordGate();
  const loadedRead = useRef(() => false);
  const writeFor = useRef(0);
  // Writes on one fund go one after another, each naming the `updated_at` the
  // one before it left, so two saves in flight never conflict with each other.
  const queue = useRef(Promise.resolve());
  useEffect(() => { writeFor.current += 1; setFieldState({}); setNotice(null); setConflict(null); setChooserOpen(false); }, [uid]);
  useEffect(() => () => { gate.current.invalidate(); writeFor.current += 1; }, []);

  const load = useCallback(async () => {
    const fresh = gate.current.begin();
    loadedRead.current = fresh;
    const key = recordKey(uid);
    setLoading(true);
    setError(null);
    setFund(null);
    fundRef.current = null;
    setLoadedKey(null);
    try {
      const row = await api.research.fundGet(uid);
      if (!fresh()) return;
      setLoadedKey(key);
      showFund(row);
      setDrafts(draftsFrom(row));
      setEditingThesis(!row.thesis);
      setEditingSource(!row.source_url);
    } catch (e) {
      if (!fresh()) return;
      setFund(null);
      setError(e?.status === 404
        ? 'This fund is not on your list.'
        : (e?.message || 'The fund did not load.'));
    } finally {
      if (fresh()) setLoading(false);
    }
  }, [uid]);
  const current = sameRecord(loadedKey, routeKey);

  useEffect(() => { load(); }, [load]);

  const dirty = fund ? dirtyFields(drafts, fund) : [];
  const noteDirty = dirty.includes('note');
  // The leave guard: an in-app link, Back and Forward, a reload or a closed tab
  // ask first while any field holds unsaved text (D4961's guard).
  useLeaveGuard(dirty.length > 0, leaveMessage(fund?.name));

  /**
   * Save `patch`, then re-read the row. `sent` names the draft fields the
   * patch carries; `label` is what the status line and the announcement say.
   */
  const apply = (patch, sent = [], label = 'Changes') => {
    if (!current) return Promise.resolve(null);
    const target = JSON.parse(loadedKey)[0];
    const route = writeFor.current;
    const keys = sent.length ? sent : Object.keys(patch);
    setNotice(null);
    setFieldState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { phase: 'saving' }])) }));
    const run = async () => {
      if (writeFor.current !== route) return null;
      const base = fundRef.current;
      try {
        await api.research.fundUpdate(target, { ...patch, expected_updated_at: base?.updated_at || undefined });
        const row = await api.research.fundGet(target);
        if (writeFor.current !== route) return null;
        setDrafts((d) => mergeDrafts(d, base, row, sent));
        showFund(row);
        const at = clock();
        setFieldState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { phase: 'saved', at }])) }));
        const still = dirtyFields(drafts, base).filter((k) => !sent.includes(k));
        setAnnouncement(`${label} saved.${still.includes('note') ? ' Your note is still unsaved.' : ''}`);
        return row;
      } catch (e) {
        if (writeFor.current !== route) return null;
        if (e?.code === 'fund_changed' && e?.data?.item) {
          // Changed elsewhere since it was opened: compare both, overwrite nothing.
          const field = sent[0] || null;
          setFieldState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, null])) }));
          setConflict({
            stored: { ...base, ...e.data.item }, patch, sent, label,
            field, fieldLabel: field ? (DRAFT_FIELDS[field]?.label || field) : 'entry',
            saved: field ? DRAFT_FIELDS[field].read(e.data.item) : '',
            mine: field ? (drafts[field] ?? '') : '',
          });
          setAnnouncement(`Your ${field ? DRAFT_FIELDS[field].label : 'entry'} changed elsewhere and was not saved. Compare both versions.`);
          return null;
        }
        setFieldState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { phase: 'failed' }])) }));
        const why = !online ? 'You are offline.' : (e?.message || 'That did not save.');
        const text = sent.length
          ? `${label} did not save. Your text is still here. Nothing was lost. ${why}`
          : `${label} did not save. ${why}`;
        setNotice({ ok: false, text });
        setAnnouncement(text);
        return null;
      }
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => null);
    return next;
  };

  const saveField = async (key) => {
    const built = patchFor(key, drafts);
    if (built.error) {
      setNotice({ ok: false, text: built.error });
      setAnnouncement(built.error);
      return null;
    }
    return apply(built.patch, [key], FIELD_NAME[key] || 'Field');
  };

  const saveCheque = async (which) => {
    if (!dirty.includes(which)) return;
    await saveField(which);
  };

  const decide = (column, value) => apply({ [column]: value }, [], DECISION_NAME[column]);

  // The conflict's three ways out. Each adopts the stored row as the base, so
  // the next save names the stamp it now holds.
  const adoptStored = (stored) => {
    setDrafts((d) => mergeDrafts(d, fundRef.current, stored, []));
    showFund(stored);
  };
  const conflictKeepMine = async () => {
    const c = conflict;
    setConflict(null);
    adoptStored(c.stored);
    await apply(c.patch, c.sent, c.label);
  };
  const conflictKeepSaved = () => {
    const c = conflict;
    setConflict(null);
    adoptStored(c.stored);
    setDrafts((d) => ({ ...d, ...Object.fromEntries(c.sent.map((k) => [k, DRAFT_FIELDS[k].read(c.stored)])) }));
    setAnnouncement(`Kept the saved version of your ${c.fieldLabel}.`);
  };
  const conflictCombine = () => {
    const c = conflict;
    setConflict(null);
    adoptStored(c.stored);
    setDrafts((d) => ({ ...d, note: combineNotes(c.saved, c.mine) }));
    setAnnouncement('Both versions are in the note. Edit, then save.');
    setTimeout(() => noteRef.current?.focus?.(), 0);
  };

  // The three refresh paths share field saves’ queue, but retain the first
  // load’s ticket: beginning a refresh must not invalidate another pending read.
  const queueRefresh = (work) => {
    if (!current) return Promise.resolve();
    const key = loadedKey;
    const epoch = writeFor.current;
    const fresh = loadedRead.current;
    const belongs = () => fresh() && epoch === writeFor.current && sameRecord(key, route.current);
    const target = JSON.parse(key)[0];
    const run = async () => {
      if (!belongs()) return;
      try { await work(target, belongs); }
      catch (error) { if (belongs()) throw error; }
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => null);
    return next;
  };
  const link = (catalogueUid) => queueRefresh(async (target, belongs) => {
    await api.research.fundUpdate(target, { catalogue_uid: catalogueUid });
    if (!belongs()) return;
    const row = await api.research.fundGet(target);
    if (!belongs()) return;
    setDrafts((d) => mergeDrafts(d, fundRef.current, row, []));
    showFund(row);
    setChooserOpen(false);
    setAnnouncement(`Linked to ${row.public_record?.record?.name || catalogueUid}. Catalogue id ${catalogueUid}. Your note and reads are unchanged.`);
    setTimeout(() => { if (belongs()) identityRef.current?.focus?.(); }, 0);
  });
  const keepOwn = () => queueRefresh(async (target, belongs) => {
    await api.research.fundUpdate(target, { own_record: true });
    if (!belongs()) return;
    const row = await api.research.fundGet(target);
    if (!belongs()) return;
    setDrafts((d) => mergeDrafts(d, fundRef.current, row, []));
    showFund(row);
    setChooserOpen(false);
    setAnnouncement('Kept as your own record. It will not be offered a match again. You can link it later from its identity block.');
    setTimeout(() => { if (belongs()) identityRef.current?.focus?.(); }, 0);
  });

  // Accept already wrote the brief. Its queued re-read preserves other edits.
  const acceptedBrief = () => queueRefresh(async (target, belongs) => {
    const before = (fundRef.current?.note || '').trim().length;
    try {
      const row = await api.research.fundGet(target);
      if (!belongs()) return;
      setDrafts((d) => mergeDrafts(d, fundRef.current, row, ['note']));
      showFund(row);
      setAnnouncement(`Brief written into your note at ${clock()}. Nothing was sent to ${row.name}.`);
      setTimeout(() => {
        if (!belongs()) return;
        const el = noteRef.current;
        if (!el) return;
        el.focus?.();
        const at = Math.min(before ? before + 2 : 0, String(row.note || '').length);
        el.setSelectionRange?.(at, String(row.note || '').length);
      }, 0);
    } catch {
      if (belongs()) await load();
    }
  });

  const checklist = missingChecklist(fund);
  const gaps = gapCount(checklist);
  const updated = updatedAgo(fund?.updated_at);
  const ch = fund ? chequeTile(fund.cheque_min_cents, fund.cheque_max_cents) : null;
  const passed = fund?.status === 'passed';
  const passMissing = passed && !fund?.pass_reason;
  const saving = (k) => fieldState[k]?.phase === 'saving';
  const statusLine = conflict
    ? 'Your note changed elsewhere · not saved'
    : dirty.length
      ? `Unsaved changes to your ${dirty.map((k) => DRAFT_FIELDS[k].label).join(', ')}`
      : 'All changes saved';

  return (
    <WorkspaceShell
      role={role}
      title={fund?.name || 'Fund'}
      activeSlug="funds"
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="This page does not score a fund or email one"
          note="Accept writes the note already on this page. It does not send anything."
          coverage={[fund
            ? `${fund.name}: ${stageLabel(fund.stage_fit)} · ${pathLabel(fund.path)} · ${statusLabel(fund.status)}`
            : 'One researched fund']}
          unavailable={[
            ['A fit score', 'Nothing here scores a fund or ranks the list. The brief restates this row and asks about its gaps.'],
            ['Fund size and investments', 'No store holds a fund’s public size or what it has funded yet.'],
            ['An email', 'Accept writes your note. It does not email them.'],
          ]}
        />
      )}
    >
      <div data-testid="fund-dossier" className="space-y-3">
        {/* D7168: one polite live region for every save, link and accept. */}
        <p role="status" aria-live="polite" className="sr-only" data-testid="fund-dossier-announce">{announcement}</p>
        {loading && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this fund.</p>
          </Card>
        )}
        {error && (
          <Card variant="dashed" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This did not load</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              {error} Nothing is shown rather than an empty fund, because an empty page here would
              say the row has no reading — and that is not something this page can currently know.
            </p>
            <button type="button" onClick={load} className={`${ghostBtn} mt-3`}>Try again</button>
          </Card>
        )}

        {fund && current && (
          <>
            {!online && (
              <p data-testid="fund-dossier-offline" className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                You are offline. Your text is kept on this page until you reconnect. It is not stored in the browser after you close the tab.
              </p>
            )}
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={passed ? 'danger' : 'neutral'}>{statusLabel(fund.status)}</Pill>
                    <Pill tone={fund.stage_fit === 'right' ? 'ok' : fund.stage_fit === 'wrong' ? 'warn' : 'neutral'}>
                      {stageLabel(fund.stage_fit)}
                    </Pill>
                    <Pill tone={fund.path === 'warm' ? 'ok' : 'neutral'}>{pathLabel(fund.path)}</Pill>
                  </div>
                  <IdentityBand fund={fund} onChoose={() => setChooserOpen(true)} chooseRef={chooseRef} focusRef={identityRef} />
                  <div className="mt-2">
                    <SourceLine value={fund.source_url} />
                  </div>
                  {(editingSource || !fund.source_url) && (
                    <div className="mt-2 max-w-md">
                      <Field label="Source URL" hint="Optional. A blank stays blank.">
                        <input
                          className={inputClass}
                          value={drafts.source_url}
                          placeholder="https://"
                          onChange={(e) => setDraft('source_url', e.target.value)}
                        />
                      </Field>
                      <button
                        type="button"
                        className={`${primaryBtn} mt-2`}
                        disabled={saving('source_url')}
                        onClick={() => saveField('source_url')}
                      >
                        Save source
                      </button>
                    </div>
                  )}
                  {fund.source_url && !editingSource && (
                    <button type="button" className={`${ghostBtn} mt-2`} onClick={() => setEditingSource(true)}>
                      Edit source
                    </button>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Your read · private</div>
                  <p className="mt-1 text-[11px] text-axal-muted">Three separate decisions · each saves on its own</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Stage</span>
                      <select
                        aria-label={`Stage fit for ${fund.name}`}
                        className={selectClass}
                        value={fund.stage_fit || ''}
                        onChange={(e) => decide('stage_fit', e.target.value)}
                      >
                        <option value="">Stage not assessed</option>
                        <option value="right">Right stage</option>
                        <option value="wrong">Wrong stage</option>
                      </select>
                      <span className="mt-1 block"><FieldState state={fieldState.stage_fit} /></span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Path</span>
                      <select
                        aria-label={`Route in for ${fund.name}`}
                        className={selectClass}
                        value={fund.path || ''}
                        onChange={(e) => decide('path', e.target.value)}
                      >
                        <option value="">Route not recorded</option>
                        <option value="warm">Warm path</option>
                        <option value="cold">No route in</option>
                      </select>
                      <span className="mt-1 block"><FieldState state={fieldState.path} /></span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Status</span>
                      <select
                        aria-label={`Status for ${fund.name}`}
                        className={selectClass}
                        value={fund.status || 'researching'}
                        onChange={(e) => decide('status', e.target.value)}
                      >
                        <option value="researching">Researching</option>
                        <option value="passed">Passed</option>
                      </select>
                      <span className="mt-1 block"><FieldState state={fieldState.status} /></span>
                    </label>
                  </div>
                </div>
              </div>
              <p data-testid="fund-dossier-save-line" className="mt-2 text-[11px] font-semibold text-axal-muted">{statusLine}</p>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile k="Cheque" nr={ch.nr} v={ch.v} sub={ch.sub} />
              <Tile
                k="Stage"
                v={stageLabel(fund.stage_fit)}
                sub="your read, not theirs"
                tone={stageTileTone(fund.stage_fit)}
              />
              <Tile
                k="Path"
                v={pathLabel(fund.path)}
                sub={fund.path === 'warm' ? 'a route exists' : fund.path === 'cold' ? 'no route recorded in' : 'route not yet recorded'}
                tone={pathTileTone(fund.path)}
              />
              <Tile
                k="Last updated"
                nr={!updated}
                v={updated}
                sub={updated ? 'by you' : 'this row carries no update stamp'}
              />
            </div>

            <p data-testid="fund-dossier-overlap" className="px-0.5 text-[12px] leading-relaxed text-axal-muted">
              {fund.overlap_note}
            </p>

            {passMissing && (
              <div
                data-testid="fund-dossier-pass-warn"
                className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
              >
                <span className="font-extrabold" aria-hidden="true">!</span>
                <span>Passed with no reason recorded — worth adding one before you rediscover them.</span>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <PublicRecordCard record={fund.public_record} />
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint"><span aria-hidden="true">🔒 </span>Your private dossier</span>
                  <span className="text-[10.5px] text-axal-muted">Only you can see this</span>
                </div>
                <div className="mt-3 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Their thesis</div>
                {fund.thesis && !editingThesis ? (
                  <>
                    <p className="mt-2.5 text-[18px] font-medium italic leading-snug text-axal-ink">“{fund.thesis}”</p>
                    <button type="button" className={`${ghostBtn} mt-3`} onClick={() => setEditingThesis(true)}>Edit thesis</button>
                  </>
                ) : (
                  <>
                    {!fund.thesis && (
                      <>
                        <div className="mt-2.5"><Nr /></div>
                        <p className="mt-1.5 text-[12px] text-axal-muted">quoted in their words, not summarised</p>
                      </>
                    )}
                    <Field label={fund.thesis ? 'Edit their words' : 'Record their words'}>
                      <textarea
                        className={`${inputClass} min-h-[88px]`}
                        value={drafts.thesis}
                        onChange={(e) => setDraft('thesis', e.target.value)}
                      />
                    </Field>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={primaryBtn}
                        disabled={saving('thesis')}
                        onClick={async () => {
                          const saved = await saveField('thesis');
                          if (saved) setEditingThesis(!saved.thesis);
                        }}
                      >
                        Save thesis
                      </button>
                      <FieldState dirty={dirty.includes('thesis')} state={fieldState.thesis} />
                    </div>
                  </>
                )}
                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What the research says · your note</span>
                  <FieldState dirty={noteDirty} state={fieldState.note} />
                </div>
                <textarea
                  ref={noteRef}
                  aria-label="What the research says"
                  data-testid="fund-dossier-note"
                  className={`${inputClass} min-h-[88px]`}
                  value={drafts.note}
                  maxLength={2000}
                  placeholder="Your read of this fund…"
                  onChange={(e) => setDraft('note', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveField('note'); }
                  }}
                />
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] text-axal-muted">{`${drafts.note.length.toLocaleString('en-US')} / 2,000 characters`}</span>
                  <button type="button" className={primaryBtn} disabled={saving('note')} onClick={() => saveField('note')}>
                    {saving('note') ? 'Saving…' : 'Save note'}
                  </button>
                </div>
                {!fund.note && !noteDirty && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Nr />
                    <span className="text-[12px] text-axal-muted">the reading that matters is yours to write</span>
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card data-testid="fund-dossier-cheque">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Cheque range and your round</span>
                  <span className="text-[10.5px] text-axal-muted">A note, not a score</span>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                  <Field label="Low (USD)">
                    <input
                      data-testid="fund-dossier-cheque-low"
                      className={`${inputClass} font-mono`}
                      value={drafts.lo}
                      placeholder="blank"
                      inputMode="decimal"
                      onChange={(e) => setDraft('lo', e.target.value)}
                      onBlur={() => saveCheque('lo')}
                    />
                  </Field>
                  <Field label="High (USD)">
                    <input
                      data-testid="fund-dossier-cheque-high"
                      className={`${inputClass} font-mono`}
                      value={drafts.hi}
                      placeholder="blank"
                      inputMode="decimal"
                      onChange={(e) => setDraft('hi', e.target.value)}
                      onBlur={() => saveCheque('hi')}
                    />
                  </Field>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">
                  Stored as cents; the UI is dollars. A blank stays blank — it is never written as 0.
                </p>
                <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Whole-round test</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">
                    Compares their range with your whole round, the raise target on the active company’s project.
                  </p>
                  <p className="mt-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">{fund.overlap_note}</p>
                </div>
                <div data-testid="fund-dossier-allocation" className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Allocation test</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">
                    Compares their range with what you intend to raise from this fund. Set per fund, in USD; a range in another currency is not compared.
                  </p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label="Your allocation (USD)">
                      <input
                        data-testid="fund-dossier-allocation-input"
                        className={`${inputClass} font-mono`}
                        value={drafts.alloc}
                        placeholder="blank"
                        inputMode="decimal"
                        onChange={(e) => setDraft('alloc', e.target.value)}
                        onBlur={() => saveCheque('alloc')}
                      />
                    </Field>
                    <FieldState dirty={dirty.includes('alloc')} state={fieldState.alloc} />
                  </div>
                  <p className="mt-1.5 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
                    {fund.allocation_test?.note || 'No allocation is set for this fund, so the test is not run.'}
                  </p>
                </div>
              </Card>
              <Card data-testid="fund-dossier-pass-card" className={passCardClass(fund)}>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Pass reason</div>
                {passed ? (
                  <>
                    <textarea
                      aria-label="Pass reason"
                      className={`${inputClass} min-h-[56px] ${passMissing ? 'border-red-200 text-red-700 placeholder:text-red-400 dark:border-red-800 dark:text-red-300' : ''}`}
                      value={drafts.pass_reason}
                      placeholder="Passed with no reason recorded — worth adding one before you rediscover them."
                      onChange={(e) => setDraft('pass_reason', e.target.value)}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" className={primaryBtn} disabled={saving('pass_reason')} onClick={() => saveField('pass_reason')}>
                        Save reason
                      </button>
                      <FieldState dirty={dirty.includes('pass_reason')} state={fieldState.pass_reason} />
                    </div>
                  </>
                ) : (
                  <p className="mt-2.5 text-[12px] leading-relaxed text-axal-muted">
                    Appears when the status is set to Passed. This fund is still live.
                  </p>
                )}
              </Card>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card data-testid="fund-dossier-size">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Public size, if you recorded it</div>
                <div className="mt-2.5"><Nr /></div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
                  {NO_STORE.size} A missing year would be drawn as a gap, never as a fund that shrank.
                </p>
              </Card>
              <Card data-testid="fund-dossier-funded">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What they have funded</div>
                <div className="mt-2.5"><Nr /></div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
                  {NO_STORE.investments} An empty list here would not mean they have funded nothing.
                </p>
              </Card>
            </div>

            <FundReportsPanel fundUid={fund.uid} />

            <Card data-testid="fund-dossier-missing">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What’s missing before a meeting</span>
                <span className={`text-[11px] font-bold ${gaps ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {gaps ? `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` : 'nothing this page can close'}
                </span>
              </div>
              <ul className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {checklist.map((r) => (
                  <li key={r.key} className="flex items-start gap-2 text-[12px]">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 font-extrabold ${r.done === true ? 'text-emerald-700 dark:text-emerald-300' : r.done === false ? 'text-amber-800 dark:text-amber-300' : 'text-axal-faint'}`}
                    >
                      {r.done === true ? '✓' : r.done === false ? '○' : '–'}
                    </span>
                    <span>
                      <span className={`font-semibold ${r.done === false ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted'}`}>{r.label}</span>
                      {r.done === null ? <span className="ml-1.5"><Nr /></span> : null}
                      <span className="block text-[11px] text-axal-muted">{r.sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] text-axal-muted">
                Rows marked Not recorded have no store yet, so they are not counted as gaps you can close here.
              </p>
            </Card>

            <ZoneDraft
              surface="research/funds"
              railOption="draft:research/funds"
              scopeKey={fund.uid}
              scoped
              accent="violet"
              label="Proposal · pre-meeting brief"
              run="Draft the brief"
              accept="Write into the note"
              empty="A short brief from this row alone: their thesis quoted back, your note, and every gap above turned into a question to ask. It will not name a partner, cite an AUM, or assume an introduction."
              nothingToDraft={NOTHING_TO_DRAFT}
              blocked={nothingToDraft(fund) ? NOTHING_TO_DRAFT : null}
              acceptBlocked={acceptWaitReason(noteDirty)}
              foot="Accept writes your note. It does not email them. Writes your private note only · the fund receives no message."
              onAccepted={acceptedBrief}
            />

            <StatedLimit title="What this page will not do">
              Nothing here scores a fund for you, ranks your list, or writes to the fund. The brief is drafted
              only when you press for it, from this row alone.
            </StatedLimit>

            {chooserOpen && (
              <CatalogueChooser
                fund={fund}
                onClose={() => setChooserOpen(false)}
                onLink={link}
                onKeepOwn={keepOwn}
                returnFocusTo={chooseRef}
              />
            )}
            {conflict && (
              <ConflictSheet
                conflict={{ field: conflict.field, label: conflict.fieldLabel, saved: conflict.saved, mine: conflict.mine }}
                onCombine={conflictCombine}
                onKeepMine={conflictKeepMine}
                onKeepSaved={conflictKeepSaved}
                onClose={() => setConflict(null)}
              />
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
