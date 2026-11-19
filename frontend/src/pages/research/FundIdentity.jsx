import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill, Sheet } from '../../ui';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import { researchMyFundsApi } from '../../lib/api/researchMyFunds.js';
import { identityChip } from './myFundsRead';

/**
 * D7168 (#7168) — the fund dossier's identity block, its read-only public
 * record, the legacy chooser and the conflict Sheet (canvas D7033, FND-S02 to
 * FND-S04).
 *
 * THE PUBLIC RECORD IS THE CATALOGUE'S, READ-ONLY, AND APART. It is what the
 * Worker answers on `public_record` for the row's catalogue uid: the vehicle,
 * Unavailable when the catalogue could not be read, or withdrawn when its list
 * was taken down (410). An entry with no catalogue uid has none, and nothing
 * is borrowed from a similar name.
 *
 * THE CHOOSER NEVER LINKS ON ITS OWN (D7033 Q1, drawn as A). It lists the
 * catalogue vehicles a search by the entry's name finds, marks one already
 * linked to another of your entries as refused, and offers Keep as my own
 * record, which stops the prompt for good (Q2, drawn as A). Linking changes
 * only which vehicle the entry points to.
 */

const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const GHOST = 'rounded-lg border border-violet-200 px-3 py-1.5 text-[12px] font-semibold text-violet-800 '
  + 'hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950/40';
const PRIMARY = 'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:opacity-70';

export function IdentityChip({ fund }) {
  const chip = identityChip(fund);
  const glyph = chip.kind === 'linked' ? '⛓' : chip.kind === 'own' ? '✎' : '?';
  return (
    <Pill tone={chip.kind === 'linked' ? 'ok' : chip.kind === 'legacy' ? 'warn' : 'neutral'}>
      <span aria-hidden="true">{glyph} </span>{chip.label}
    </Pill>
  );
}

/** The dossier's identity block: the chip, what it means, and the one way on from it. */
export function IdentityBand({ fund, onChoose, chooseRef, focusRef }) {
  const chip = identityChip(fund);
  return (
    <div data-testid="fund-dossier-identity" ref={focusRef} tabIndex={-1} className="mt-2 flex flex-wrap items-center gap-2 outline-none">
      <span className={LABEL}>Identity</span>
      <IdentityChip fund={fund} />
      <span className="font-mono text-[10px] text-axal-muted">Private fund dossier · {fund.uid}</span>
      {chip.kind === 'linked' ? (
        <Link
          to={`/research/funds/catalog/${encodeURIComponent(fund.catalogue_uid)}`}
          className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300"
        >
          Open catalogue vehicle →
        </Link>
      ) : (
        <button type="button" ref={chooseRef} className={GHOST} onClick={onChoose}>
          {chip.kind === 'legacy' ? 'Choose the record…' : 'Link to a catalogue vehicle…'}
        </button>
      )}
      <p className="basis-full text-[12px] text-axal-muted">
        {chip.kind === 'linked'
          ? 'Opens the vehicle by this identifier, never by name.'
          : chip.kind === 'own'
            ? 'Your own record. No catalogue record is linked, so no public figures are shown.'
            : 'Saved before catalogue links. It is not linked to any vehicle until you choose; nothing is linked by name in the meantime.'}
      </p>
    </div>
  );
}

const FIELDS = [
  ['uid', 'Catalogue id'], ['name', 'Vehicle'], ['fund_number', 'Fund number'], ['hq', 'Headquarters'],
  ['sector_focus', 'Focus'], ['fund_year', 'Fund year'], ['as_of', 'As of'],
];

/** The catalogue's facts for a linked entry, or why there are none. Never editable here. */
export function PublicRecordCard({ record }) {
  const state = record?.state || 'not_linked';
  const r = record?.record || null;
  return (
    <Card data-testid="fund-dossier-public-record" data-state={state}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL}><span aria-hidden="true">🔒 </span>Public record</span>
        <span className="text-[10.5px] text-axal-muted">Read-only · from the catalogue</span>
      </div>
      {state === 'ok' && r ? (
        <>
          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            {FIELDS.filter(([k]) => r[k] != null && r[k] !== '').map(([k, label]) => (
              <React.Fragment key={k}>
                <dt className="text-axal-muted">{label}</dt>
                <dd className={k === 'uid' ? 'font-mono text-axal-ink dark:text-gray-100' : 'text-axal-ink dark:text-gray-100'}>{String(r[k])}</dd>
              </React.Fragment>
            ))}
            {r.source?.name ? (
              <>
                <dt className="text-axal-muted">Publisher</dt>
                <dd className="text-axal-ink dark:text-gray-100">{r.source.name}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-2 text-[11.5px] text-axal-muted">
            Reported fund size only. No NAV, IRR or performance is inferred. You cannot edit these facts.
          </p>
          {r.source?.url ? (
            <a href={r.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
              View the source list ↗
            </a>
          ) : null}
        </>
      ) : (
        <p className="mt-2.5 text-[12px] leading-relaxed text-axal-muted">
          {state === 'unavailable' ? <strong className="mr-1 text-axal-ink dark:text-gray-100">Unavailable.</strong> : null}
          {state === 'withdrawn' ? <strong className="mr-1 text-axal-ink dark:text-gray-100">The public record was withdrawn.</strong> : null}
          {record?.reason || 'Not linked to a catalogue vehicle, so no public facts are shown. Nothing is borrowed from a similar name.'}
          {state === 'unavailable' ? ' Your note, thesis and reads load separately and stay editable.' : ''}
        </p>
      )}
    </Card>
  );
}

/**
 * The chooser Sheet. `onLink(catalogueUid)` and `onKeepOwn()` return a promise
 * that resolves when the choice is saved, or rejects with the refusal; the
 * Sheet stays open with the choice kept when it does.
 */
export function CatalogueChooser({ fund, onClose, onLink, onKeepOwn, returnFocusTo }) {
  const legacy = identityChip(fund).kind === 'legacy';
  const [q, setQ] = useState(fund?.name || '');
  const [term, setTerm] = useState(fund?.name || '');
  const [found, setFound] = useState({ loading: true, error: null, items: [] });
  const [links, setLinks] = useState(new Map());
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState(null);

  useEffect(() => {
    let alive = true;
    setFound({ loading: true, error: null, items: [] });
    Promise.all([
      researchFundsApi.list({ q: term, limit: 8 }),
      researchMyFundsApi.list({ limit: 1 }),
    ]).then(([dir, mine]) => {
      if (!alive) return;
      setFound({ loading: false, error: null, items: dir?.items || [] });
      setLinks(new Map((mine?.catalogue_links || []).map((l) => [l.catalogue_uid, l.uid])));
    }).catch((e) => {
      if (alive) setFound({ loading: false, error: e?.message || 'The catalogue could not be read.', items: [] });
    });
    return () => { alive = false; };
  }, [term]);

  const confirm = async () => {
    if (!pick || saving) return;
    setSaving(true);
    setRefusal(null);
    try {
      if (pick === 'own') await onKeepOwn();
      else await onLink(pick);
    } catch (e) {
      const holder = e?.data?.holder;
      setRefusal(e?.code === 'catalogue_uid_taken' && holder
        ? { text: `That vehicle is already linked to another entry. ${holder.name} (${holder.uid}) points to it. Nothing changed here.`, uid: holder.uid }
        : { text: `${e?.message || 'The link did not save.'} Your choice is kept in the sheet. Try again.` });
    } finally {
      setSaving(false);
    }
  };

  const picked = pick === 'own' ? 'Keep as my own record' : found.items.find((x) => x.uid === pick)?.name;
  return (
    <Sheet
      title={legacy ? `Which ${fund.name} is this?` : 'Link to a catalogue vehicle'}
      sub={legacy ? 'Choose the vehicle this entry is about, or keep it as your own record.' : 'Choose the catalogue vehicle this record is about.'}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      phone="sheet"
      width={620}
      testId="fund-dossier-chooser"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!pick || saving} onClick={confirm}>
            {saving ? 'Saving…' : pick === 'own' ? 'Keep as my own record' : picked ? `Link to ${picked}` : 'Choose a vehicle'}
          </button>
        </div>
      )}
    >
      <div className="space-y-3 text-[12px]">
        <Card>
          <div className={LABEL}>Your entry</div>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-axal-muted">Name as saved</dt><dd>{fund.name}</dd>
            <dt className="text-axal-muted">Saved</dt><dd>{String(fund.created_at || '').slice(0, 10) || 'Not recorded'}</dd>
            <dt className="text-axal-muted">Source you recorded</dt><dd>{fund.source_url || 'Not recorded'}</dd>
          </dl>
        </Card>
        <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <label className="sr-only" htmlFor="fund-chooser-q">Search the catalogue</label>
          <input id="fund-chooser-q" className="w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-950"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className={GHOST}>Search</button>
        </form>
        <fieldset>
          <legend className="sr-only">Catalogue vehicles</legend>
          {found.loading ? <p className="text-axal-muted">Searching the catalogue…</p> : null}
          {found.error ? <p className="text-red-700 dark:text-red-300">Unavailable. {found.error} Nothing is linked.</p> : null}
          {!found.loading && !found.error && !found.items.length ? (
            <p className="text-axal-muted">No catalogue vehicle matches “{term}”. Search by another name, or keep it as your own record.</p>
          ) : null}
          <ul className="space-y-2">
            {found.items.map((v) => {
              const holder = links.get(v.uid);
              const refused = Boolean(holder && holder !== fund.uid);
              return (
                <li key={v.uid} className="rounded-lg border border-axal-hairline p-2.5 dark:border-gray-700">
                  <label className={`flex items-start gap-2 ${refused ? 'opacity-70' : ''}`}>
                    <input type="radio" name="fund-chooser" value={v.uid} disabled={refused} checked={pick === v.uid} onChange={() => setPick(v.uid)} />
                    <span>
                      <span className="font-semibold">{v.name}</span>{' '}
                      <span className="font-mono text-[10.5px] text-axal-muted">{v.uid}</span>
                      <span className="block text-axal-muted">
                        {[v.hq, v.fund_number ? `Fund ${v.fund_number}` : null, v.source?.name].filter(Boolean).join(' · ') || 'No location or list recorded'}
                      </span>
                      {refused ? (
                        <span className="block text-red-700 dark:text-red-300">
                          Already linked to your entry {holder}. One catalogue vehicle has one entry.{' '}
                          <Link to={`/research/funds/${encodeURIComponent(holder)}`} className="font-semibold underline">Open that dossier</Link>
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
            {legacy ? (
              <li className="rounded-lg border border-axal-hairline p-2.5 dark:border-gray-700">
                <label className="flex items-start gap-2">
                  <input type="radio" name="fund-chooser" value="own" checked={pick === 'own'} onChange={() => setPick('own')} />
                  <span>
                    <span className="font-semibold">Keep as my own record</span>
                    <span className="block text-axal-muted">No catalogue link. It is not offered a match again, and no public figures are shown on it.</span>
                  </span>
                </label>
              </li>
            ) : null}
          </ul>
        </fieldset>
        {refusal ? (
          <p role="alert" className="text-red-700 dark:text-red-300">
            {refusal.text}{' '}
            {refusal.uid ? <Link to={`/research/funds/${encodeURIComponent(refusal.uid)}`} className="font-semibold underline">Open it</Link> : null}
          </p>
        ) : null}
        <p className="text-axal-muted">
          Linking changes only which vehicle this entry points to. Your note, thesis, stage, route and status stay as they are. Nothing is sent to the fund.
        </p>
      </div>
    </Sheet>
  );
}

/**
 * A save refused because the row changed elsewhere (409 `fund_changed`).
 * Both versions side by side; nothing is overwritten until a choice is made.
 */
export function ConflictSheet({ conflict, onCombine, onKeepMine, onKeepSaved, onClose }) {
  const [copied, setCopied] = useState(false);
  const { field, label, saved, mine } = conflict;
  const copy = async () => {
    try { await navigator.clipboard?.writeText(mine); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Sheet
      title={`Your ${label} changed while you were editing`}
      sub="Compare both versions before choosing what to keep."
      onClose={onClose}
      phone="sheet"
      width={620}
      testId="fund-dossier-conflict"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={GHOST} onClick={copy}>{copied ? 'Copied' : 'Copy my text'}</button>
          <button type="button" className={GHOST} onClick={onKeepSaved}>Keep the saved version</button>
          <button type="button" className={GHOST} onClick={onKeepMine}>Keep mine</button>
          {field === 'note' ? <button type="button" className={PRIMARY} onClick={onCombine}>Combine both</button> : null}
        </div>
      )}
    >
      <p className="text-[12px] text-axal-muted">
        It was saved somewhere else after you opened it. Read both, then choose. Nothing is overwritten until you do.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Card data-testid="fund-conflict-saved">
          <div className={LABEL}>Saved version</div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px]">{saved || '(empty)'}</p>
        </Card>
        <Card data-testid="fund-conflict-mine">
          <div className={LABEL}>Your version · not saved</div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px]">{mine || '(empty)'}</p>
        </Card>
      </div>
      <ul className="mt-3 space-y-1 text-[12px] text-axal-muted">
        {field === 'note' ? <li><strong>Combine both</strong> opens one box with the saved text followed by your new lines. You edit, then save.</li> : null}
        <li><strong>Keep mine</strong> replaces the saved text with yours.</li>
        <li><strong>Keep the saved version</strong> discards your text. Copy it first if you may need it.</li>
      </ul>
    </Sheet>
  );
}
