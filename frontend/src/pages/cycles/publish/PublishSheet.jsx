import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { publishApi } from '../../../lib/api/publish.js';
import {
  CHECK_PASSED, CHECK_WAITS, NO_OVERRIDE, PREVIEW_WAITS, accountOn, confirmRows, counterOf, dayAndTime, destinationRows, droppedLines, findingRows, footState,
  highlightRuns, historyHref, idempotencyKey, mediaLine, moduleLabel, resultSummary, tickedLine, viewLink,
} from './publishModel.js';
import {
  BTN_PRIMARY, BTN_SECONDARY, ConfirmSend, EYEBROW, LAV_BOX, LINK, MUTED, SendActions, StatusPill, Tile,
} from './SendParts.jsx';

/**
 * D1321 (#3482, part 3 of #2400) — Publish to… (PUB1, PUB3, PUB10A, PUB12),
 * its confirm (PUB4, PUB10B) and its result (PUB5, PUB6), on D1317's `Sheet`
 * at 560px, docked beside the Eadwyn rail's spine.
 *
 *   · DESTINATIONS are part 1's read (`publishApi.destinations`): every place
 *     the founder's connections list for this company. Nothing is pre-ticked.
 *     A place switched off is muted with its reason and a link to its
 *     connector page.
 *   · THE DRAFT holds the founder's own words. The sheet keeps one
 *     `publish_drafts` row for them (created on the first check, saved on
 *     each), and archives it on close unless Save draft was pressed or
 *     something was sent.
 *   · THE PREVIEW is one tab per ticked place, with the mono counter and its
 *     text equivalent. THE CHECK is the previews' findings, highlighted in the
 *     text and listed; there is no override. A named member is cleared by
 *     "They agreed to be named", a team-only figure by ticking team-only
 *     figures in; each is saved to the draft and the check runs again.
 *   · REVIEW AND SEND is off until every ticked place's preview is sendable.
 *     It opens the confirm; only Send there publishes, one confirm per place
 *     with a key made when the dialog opened.
 *   · THE RESULT is what each place answered, with Retry (the confirm again,
 *     for that place only), and for an outcome not known Check and Mark as
 *     not sent, never Retry.
 *
 * Who opens it is the Grow page's header (#3482's follow-up, on part 2's
 * gate); the sheet itself refuses nothing the Worker does not.
 */
export default function PublishSheet({ projectId, module, onClose, api = publishApi, delay = 500, start = null }) {
  const [read, setRead] = useState({ status: 'loading', rows: [], canPublish: false, error: '' });
  const [ticked, setTicked] = useState([]);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState([]);
  const [teamOnly, setTeamOnly] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [tab, setTab] = useState(null);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const [saved, setSaved] = useState('');
  const [prefill, setPrefill] = useState(start ? { status: 'loading' } : null);
  const draft = useRef(null);
  const kept = useRef(false);
  const chain = useRef(Promise.resolve());
  const seq = useRef(0);
  const keys = useRef({});

  const load = useCallback(() => {
    setRead((r) => ({ ...r, status: 'loading', error: '' }));
    api.destinations(projectId)
      .then((res) => setRead({ status: 'ready', rows: destinationRows(res), canPublish: res?.can_publish === true, error: '' }))
      .catch((e) => setRead({ status: 'error', rows: [], canPublish: false, error: e?.message || 'Your places could not be read.' }));
  }, [api, projectId]);
  useEffect(() => { load(); }, [load]);

  /** One write at a time, in order: create the draft once, then save onto it. */
  const write = useCallback((body) => {
    const next = chain.current.then(async () => {
      if (!draft.current) {
        const r = await api.createDraft({ project_id: projectId, module, text: body.text ?? '' });
        draft.current = r?.draft || null;
        const rest = { ...body }; delete rest.text;
        if (draft.current && Object.keys(rest).length) await api.saveDraft(draft.current.uid, rest);
      } else {
        await api.saveDraft(draft.current.uid, body);
      }
      return draft.current;
    });
    chain.current = next.catch(() => {});
    return next;
  }, [api, projectId, module]);

  // D1321 follow-up: opened from a Grow page or a sent update, the draft starts
  // pre-filled from its records (D1333's builders), each line with its source.
  // It is still a draft the founder edits; closing without keeping it archives it.
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    const made = chain.current.then(async () => {
      const r = start.kind === 'update' ? await api.draftFromUpdate(start.uid) : await api.createDraft({ project_id: projectId, module });
      const uid = r?.draft?.uid || r?.draft_uid || null;
      if (!uid) throw new Error('The draft could not be started.');
      const d = r?.draft?.body ? r.draft : (await api.draft(uid))?.draft;
      draft.current = d || { uid };
      setText(String(d?.body?.text || ''));
      setPrefill({ status: 'ready', chip: r?.prefill?.chip || null, lines: r?.prefill?.lines ?? null, dropped: r?.prefill?.dropped || null });
      return draft.current;
    });
    chain.current = made.catch((e) => { setPrefill({ status: 'error', error: e?.message || 'The draft could not be started. Write your own below.' }); });
  }, [start, api, projectId, module]);

  // The check: after a pause in typing, save the text and preview every ticked place.
  useEffect(() => {
    if (result) return undefined;
    const mine = ++seq.current;
    if (!text.trim()) { setPreviews([]); setChecking(false); setCheckError(''); return undefined; }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const d = await write({ text, named_consent: consent, team_only_included: teamOnly });
        const out = d && ticked.length ? (await api.preview(d.uid, ticked))?.previews || [] : [];
        if (mine !== seq.current) return;
        setPreviews(out); setCheckError('');
      } catch (e) {
        if (mine !== seq.current) return;
        setPreviews([]); setCheckError(e?.message || 'The check could not run. Nothing was sent.');
      } finally { if (mine === seq.current) setChecking(false); }
    }, delay);
    return () => clearTimeout(t);
  }, [text, ticked, consent, teamOnly, delay, write, api, result]);

  // A draft nobody kept is archived when the sheet closes.
  useEffect(() => () => {
    if (draft.current && !kept.current) api.archiveDraft(draft.current.uid)?.catch?.(() => {});
  }, [api]);

  const toggle = (uid) => setTicked((t) => (t.includes(uid) ? t.filter((x) => x !== uid) : [...t, uid]));
  const foot = footState({ text, ticked, previews, checking });
  const mine = ticked.map((uid) => previews.find((p) => p.destination_uid === uid)).filter(Boolean);
  const findings = findingRows(mine);
  const open = mine.find((p) => p.destination_uid === tab) || mine[0] || null;

  const saveDraft = async () => {
    try { await write({ text, named_consent: consent, team_only_included: teamOnly }); kept.current = true; setSaved('Draft saved. It stays here until you send or delete it.'); }
    catch (e) { setSaved(e?.message || 'The draft could not be saved.'); }
  };
  const review = () => {
    keys.current = Object.fromEntries(ticked.map((uid) => [uid, idempotencyKey()]));
    setAsking(true);
  };
  const send = async () => {
    const out = [];
    for (const p of mine) {
      try {
        const r = await api.confirm(draft.current.uid, { destination_uid: p.destination_uid, envelope_hash: p.envelope_hash, idempotency_key: keys.current[p.destination_uid] });
        out.push(r.send);
      } catch (e) {
        out.push({ uid: `refused-${p.destination_uid}`, local: true, status: 'failed', provider_key: p.provider_key, destination: p.account, audience: p.audience, refusal: e?.message || 'It was not sent.' });
      }
    }
    kept.current = true;
    setAsking(false);
    setResult({ sends: out, at: new Date().toISOString() });
  };
  const replace = (s) => s && setResult((r) => ({ ...r, sends: r.sends.map((x) => (x.uid === s.uid ? s : x)) }));

  const eyebrow = `Publish from · ${moduleLabel(module)}`;
  if (result) {
    const sum = resultSummary(result.sends);
    const when = dayAndTime(result.at);
    return (
      <Sheet eyebrow={eyebrow} title={sum.title} sub={`Confirmed by you · ${when.day}, ${when.time}`} width={560} onClose={onClose} testId="publish-sheet"
        footer={(
          <div className="flex items-center gap-2.5">
            <Link to={historyHref()} className={LINK} onClick={onClose} data-testid="publish-open-history">Open sent history ›</Link>
            <span className="flex-1" />
            <button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button>
          </div>
        )}>
        <div className="flex flex-col gap-3 px-5 py-[18px]" data-testid="publish-result">
          <div className={LAV_BOX} data-testid="publish-result-line">{sum.line}</div>
          <ul className="m-0 list-none overflow-hidden rounded-xl border border-axal-hairline p-0 dark:border-gray-700">
            {result.sends.map((s) => <ResultRow key={s.uid} send={s} api={api} onChanged={replace} onRetry={setRetrying} />)}
          </ul>
          {result.sends.some((s) => s.status === 'failed' && !s.local) && <p className={`m-0 text-[12px] ${MUTED}`}>Retry opens the confirm step again, for that place only.</p>}
        </div>
        {retrying && (
          <ConfirmSend rows={[{ uid: retrying.uid, provider_key: retrying.provider_key, title: accountOn(retrying.destination, retrying.provider_key), line: retrying.audience || 'Audience not stated' }]}
            onCancel={() => setRetrying(null)} onSend={async () => { const r = await api.retry(retrying.uid); setRetrying(null); replace(r?.send); }} />
        )}
      </Sheet>
    );
  }

  return (
    <Sheet eyebrow={eyebrow} title="Publish to…" width={560} onClose={onClose} testId="publish-sheet"
      footer={(
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" className={BTN_SECONDARY} disabled={!text.trim()} onClick={saveDraft} data-testid="publish-save">Save draft</button>
          <span className={`flex-1 text-right text-[12px] ${MUTED}`} data-testid="publish-why">{foot.why || ''}</span>
          <button type="button" className={BTN_PRIMARY} disabled={!foot.on || !read.canPublish} onClick={review} data-testid="publish-review">Review and send</button>
        </div>
      )}>
      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        <Destinations read={read} ticked={ticked} onToggle={toggle} onRetry={load} />
        <section className="flex flex-col gap-2" aria-labelledby="publish-draft-h" data-testid="publish-draft">
          <span id="publish-draft-h" className={EYEBROW}>Draft</span>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(''); }} rows={6} aria-label="Your post" placeholder="Write your post."
            className="w-full resize-y rounded-[7px] border border-[#dcd8e4] bg-white px-3 py-2.5 text-[13.5px] leading-[1.55] text-axal-ink placeholder:text-[#a1a1aa] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
            data-testid="publish-text" />
          {findings.some((f) => f.offset != null) && (
            <p className="m-0 rounded-[7px] border border-red-200 bg-white px-3 py-2.5 text-[13.5px] leading-[1.55] text-axal-ink dark:border-red-400/40 dark:bg-gray-950 dark:text-gray-100" data-testid="publish-highlight">
              <span className="sr-only">Your text, with what to remove marked: </span>
              {highlightRuns(text, findings).map((r, i) => (r.mark
                ? <mark key={i} className="rounded-[3px] bg-red-50 px-0.5 text-inherit shadow-[inset_0_-2px_0_#b91c1c] dark:bg-red-400/15 dark:shadow-[inset_0_-2px_0_#f87171]">{r.text}</mark>
                : <React.Fragment key={i}>{r.text}</React.Fragment>))}
            </p>
          )}
          <PrefillNote prefill={prefill} />
          {saved && <p role="status" className={`m-0 text-[12px] ${MUTED}`} data-testid="publish-saved">{saved}</p>}
        </section>
        <Preview text={text} ticked={ticked} mine={mine} open={open} onTab={setTab} />
        <Check text={text} ticked={ticked} checking={checking} error={checkError} findings={findings} consent={consent} teamOnly={teamOnly}
          onConsent={(id, on) => setConsent((c) => (on ? [...new Set([...c, id])] : c.filter((x) => x !== id)))} onTeamOnly={setTeamOnly} />
      </div>
      {asking && <ConfirmSend rows={confirmRows(mine, read.rows)} onCancel={() => setAsking(false)} onSend={send} />}
    </Sheet>
  );
}

/** The pre-fill's source chip and what it left out, never a figure it did not have. */
function PrefillNote({ prefill }) {
  if (!prefill) return null;
  if (prefill.status === 'loading') return <p className={`m-0 text-[12px] ${MUTED}`} aria-busy="true" data-testid="publish-prefill-loading">Drafting from your records…</p>;
  if (prefill.status === 'error') return <p role="alert" className={`m-0 text-[12px] ${MUTED}`} data-testid="publish-prefill-error">{prefill.error}</p>;
  const left = droppedLines(prefill.dropped);
  return (
    <div className="flex flex-col gap-1.5" data-testid="publish-prefill">
      {prefill.chip && prefill.lines > 0 && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-axal-hairline bg-[#f7f6fa] px-2.5 py-0.5 text-[11.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid="publish-chip">
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-amber-500" />Recorded · {prefill.chip}
        </span>
      )}
      {prefill.lines === 0 && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="publish-prefill-none">Nothing recorded here yet to draft from. Write your own.</p>}
      {left.map((l) => <p key={l} className={`m-0 text-[12px] ${MUTED}`}>{l}</p>)}
    </div>
  );
}

function Destinations({ read, ticked, onToggle, onRetry }) {
  let body;
  if (read.status === 'loading') body = <p className={`m-0 text-[12.5px] ${MUTED}`} aria-busy="true" data-testid="publish-dest-loading">Reading your places…</p>;
  else if (read.status === 'error') body = (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="publish-dest-error">
      <span className={MUTED}>{read.error}</span><button type="button" className={BTN_SECONDARY} onClick={onRetry}>Try again</button>
    </div>
  );
  else if (!read.canPublish) body = <div className={LAV_BOX} data-testid="publish-founder-only">Only the founder publishes for this company. You can read what was published in Published outside.</div>;
  else if (!read.rows.length) body = (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="publish-dest-none">
      <span className={MUTED}>No place to publish to yet. Connect one first. Nothing is posted until you confirm it.</span>
      <Link to="/account/connectors" className={LINK}>Open Connectors</Link>
    </div>
  );
  else body = (
    <ul className="m-0 list-none overflow-hidden rounded-xl border border-axal-hairline p-0 dark:border-gray-700" data-testid="publish-dests">
      {read.rows.map((d) => {
        const id = `publish-dest-${d.uid}`;
        return (
          <li key={d.uid} className={`flex min-h-[46px] items-center gap-3 border-t border-axal-hairline px-3 py-1.5 first:border-t-0 dark:border-gray-700 ${d.on ? '' : 'opacity-70'}`} data-testid={id}>
            <input id={`${id}-box`} type="checkbox" checked={ticked.includes(d.uid)} disabled={!d.on} onChange={() => onToggle(d.uid)}
              className="h-[18px] w-[18px] flex-none accent-violet-600" data-testid={`${id}-box`} />
            <Tile provider={d.provider_key} />
            <label htmlFor={`${id}-box`} className="min-w-0 flex-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
              {accountOn(d.account, d.provider_key)}
              {!d.on && <span className={`block text-[11.5px] font-normal ${MUTED}`}>{d.reason}</span>}
            </label>
            {d.on
              ? d.audience && <span className={`flex-none rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold ${MUTED} dark:border-gray-700`}>{d.audience.split(':')[0]}</span>
              : <Link to={d.href} className={LINK}>Turn on</Link>}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className="flex flex-col gap-2" aria-labelledby="publish-dest-h">
      <div className="flex items-baseline gap-2">
        <span id="publish-dest-h" className={EYEBROW}>Destinations</span>
        {read.status === 'ready' && read.rows.length > 0 && read.canPublish && <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="publish-ticked">{tickedLine(ticked.length, read.rows)}</span>}
        <span className="flex-1" />
        <Link to="/account/connectors" className={LINK}>Manage in Connectors</Link>
      </div>
      {body}
    </section>
  );
}

function Preview({ text, ticked, mine, open, onTab }) {
  if (!text.trim() || !ticked.length) {
    return (
      <section className="flex flex-col gap-1.5" data-testid="publish-preview-waits">
        <span className={EYEBROW}>Preview</span>
        <span className={`text-[12.5px] ${MUTED}`}>{text.trim() ? 'Tick a place to see its preview.' : PREVIEW_WAITS}</span>
      </section>
    );
  }
  const counter = open ? counterOf(open) : null;
  const media = open ? mediaLine(open) : null;
  return (
    <section className="flex flex-col gap-2.5" data-testid="publish-preview">
      <span className={EYEBROW}>Preview</span>
      <div role="tablist" aria-label="Preview for each place" className="flex gap-2 overflow-x-auto border-b border-axal-hairline sm:gap-5 dark:border-gray-700">
        {mine.map((p) => {
          const on = open?.destination_uid === p.destination_uid;
          const c = counterOf(p);
          return (
            <button key={p.destination_uid} type="button" role="tab" aria-selected={on} onClick={() => onTab(p.destination_uid)}
              className={`inline-flex min-h-[44px] flex-none items-center gap-2 whitespace-nowrap text-[12.5px] ${on ? 'font-bold text-axal-ink shadow-[inset_0_-2px_0_#7c3aed] dark:text-gray-100' : `font-semibold ${MUTED}`}`}
              data-testid={`publish-tab-${p.destination_uid}`}>
              <Tile provider={p.provider_key} size={16} />{accountOn(p.account, p.provider_key).split(' on ').pop()}
              {c && <span className={`font-mono text-[10.5px] font-semibold ${c.over ? 'text-red-700 dark:text-red-300' : MUTED}`} aria-label={c.spoken}>{c.shown}</span>}
            </button>
          );
        })}
      </div>
      {open ? (
        <div role="tabpanel" className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900" data-testid="publish-panel">
          <div className="text-[13px]"><b>{open.account}</b> <span className={MUTED}>· {open.audience || 'Audience not stated'}</span></div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-[1.5] text-axal-ink dark:text-gray-100">{text}</div>
          {(open.problems || []).length > 0 && (
            <ul className="m-0 list-none p-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="publish-problems">
              {open.problems.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
        </div>
      ) : <p className={`m-0 text-[12.5px] ${MUTED}`} aria-busy="true">Checking…</p>}
      <div className="flex items-center gap-3 text-[12px]">
        {media && <span className={MUTED}>{media}</span>}
        <span className="flex-1" />
        {counter && <span className={`font-mono text-[12px] font-semibold ${counter.over ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} aria-label={counter.spoken} data-testid="publish-counter">{counter.shown}</span>}
      </div>
    </section>
  );
}

function Check({ text, ticked, checking, error, findings, consent, teamOnly, onConsent, onTeamOnly }) {
  const head = (extra) => <div className="flex items-baseline gap-2"><span className={EYEBROW}>Check</span>{extra}</div>;
  if (!text.trim() || !ticked.length) return <section className="flex flex-col gap-1.5" data-testid="publish-check-waits">{head()}<span className={`text-[12.5px] ${MUTED}`}>{CHECK_WAITS}</span></section>;
  if (error) return <section className="flex flex-col gap-1.5">{head()}<p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="publish-check-error">{error}</p></section>;
  if (checking && !findings.length) return <section className="flex flex-col gap-1.5" aria-busy="true">{head()}<span className={`text-[12.5px] ${MUTED}`}>Checking…</span></section>;
  const cleared = [
    ...consent.filter((id) => !findings.some((f) => f.user_id === id)).map((id) => ({ key: `ok-${id}`, title: 'Names an Axal member', consentId: id })),
    ...(teamOnly && !findings.some((f) => f.teamOnly) ? [{ key: 'ok-team', title: 'Team-only figure', team: true }] : []),
  ];
  if (!findings.length) {
    return (
      <section className="flex flex-col gap-2" data-testid="publish-check-passed">
        {head()}
        <div className="flex items-start gap-2.5 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] dark:border-emerald-400/40 dark:bg-emerald-400/10">
          <span aria-hidden="true" className="grid h-5 w-5 flex-none place-items-center rounded-full bg-emerald-700 text-[12px] font-extrabold text-white dark:bg-emerald-400 dark:text-gray-900">✓</span>
          <div className="text-axal-ink dark:text-gray-100"><b className="text-emerald-800 dark:text-emerald-300">Check passed.</b> {CHECK_PASSED}</div>
        </div>
        {cleared.length > 0 && <ClearedList cleared={cleared} onConsent={onConsent} onTeamOnly={onTeamOnly} />}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2" data-testid="publish-check-findings">
      {head(<span className="font-mono text-[11.5px] font-semibold text-red-700 dark:text-red-300">{findings.length} to fix</span>)}
      <ol aria-label="Findings" className="m-0 flex list-none flex-col gap-2 p-0">
        {findings.map((f, i) => (
          <li key={f.key} className="flex items-start gap-2.5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] dark:border-red-400/40 dark:bg-red-400/10" data-testid={`publish-finding-${f.kind}`}>
            <span aria-hidden="true" className="grid h-5 w-5 flex-none place-items-center rounded-full border border-axal-hairline bg-white font-mono text-[10.5px] font-bold dark:border-gray-700 dark:bg-gray-900">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-axal-ink dark:text-gray-100">{f.title}</div>
              {f.match && <div className={`font-mono text-[11.5px] ${MUTED}`}>{f.match}</div>}
              <div className="mt-0.5 text-[12px] text-axal-ink dark:text-gray-100">{f.fix}</div>
              {f.consent && f.user_id != null && (
                <label className="mt-1.5 flex min-h-[44px] items-center gap-2 text-[12.5px] font-semibold">
                  <input type="checkbox" checked={consent.includes(f.user_id)} onChange={(e) => onConsent(f.user_id, e.target.checked)} className="h-[18px] w-[18px] accent-violet-600" data-testid={`publish-consent-${f.user_id}`} />
                  They agreed to be named
                </label>
              )}
              {f.teamOnly && (
                <label className="mt-1.5 flex min-h-[44px] items-center gap-2 text-[12.5px] font-semibold">
                  <input type="checkbox" checked={teamOnly} onChange={(e) => onTeamOnly(e.target.checked)} className="h-[18px] w-[18px] accent-violet-600" data-testid="publish-team-only" />
                  Include team-only figures in this post
                </label>
              )}
            </div>
            <StatusPill status={{ glyph: '!', word: 'To fix', tone: 'neg' }} />
          </li>
        ))}
      </ol>
      {cleared.length > 0 && <ClearedList cleared={cleared} onConsent={onConsent} onTeamOnly={onTeamOnly} />}
      <p className={`m-0 text-[12px] ${MUTED}`}>{NO_OVERRIDE}</p>
    </section>
  );
}

function ClearedList({ cleared, onConsent, onTeamOnly }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="publish-cleared">
      {cleared.map((c) => (
        <li key={c.key} className="flex items-center gap-2.5 rounded-[10px] border border-axal-hairline bg-white px-3 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900">
          <label className="flex min-h-[44px] flex-1 items-center gap-2 font-semibold">
            <input type="checkbox" checked onChange={() => (c.team ? onTeamOnly(false) : onConsent(c.consentId, false))} className="h-[18px] w-[18px] accent-violet-600" />
            {c.team ? 'Team-only figures are in this post' : 'They agreed to be named'}
          </label>
          <StatusPill status={{ glyph: '✓', word: 'Cleared', tone: 'pos' }} />
        </li>
      ))}
    </ul>
  );
}

function ResultRow({ send, api, onChanged, onRetry }) {
  const link = viewLink(send);
  const when = dayAndTime(send.sent_at || send.confirmed_at);
  return (
    <li className="flex flex-col gap-2 border-t border-axal-hairline px-3.5 py-3 first:border-t-0 dark:border-gray-700" data-testid={`publish-result-${send.uid}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Tile provider={send.provider_key} />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-axal-ink dark:text-gray-100">{accountOn(send.destination, send.provider_key)}</div>
          <div className={`text-[12px] ${MUTED}`}>{[send.audience, when.time].filter(Boolean).join(' · ')}</div>
        </div>
        <StatusPill status={send.status} />
        {link && <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>{link.label}</a>}
      </div>
      {send.local
        ? <div className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`publish-refused-${send.uid}`}>{send.refusal}</div>
        : <SendActions send={send} canPublish api={api} onChanged={onChanged} onRetry={onRetry} compact />}
    </li>
  );
}
