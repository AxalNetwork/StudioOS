/**
 * #4017 (#3710 IV-D3, D1454 §1 Q2 A, the prompt addendum of 2026-10-31): the
 * email draft as a FORM INTENT in the Ask panel (D1443 part 4, `AskIntent`).
 * It replaces D1344's draft button on a record's Email Sheet.
 *
 *   Ask       what it is for, tone, length and the live update blocks (D1344's
 *             request), and the cost line before the run, D1442's words:
 *             "Holds up to $X · you pay what it uses". Draft is pressable only
 *             once that line is on screen (`canDraft`).
 *   Preview   the draft's subject and body as Eadwyn wrote them, "Used: … Nothing
 *             else was read.", its versions (‹ ›), Regenerate and Shorter.
 *   Accept    hands the subject and body to the Sheet's form (`onAccept`), which
 *             marks the Body "Not saved". Nothing is sent: only the Sheet's own
 *             Send, behind its confirmation, sends. Discard closes the intent and
 *             leaves the form as it was.
 *
 * It reads and writes nothing else: the draft runs through D1344's
 * `/api/mail/drafts` (`api.draft`, `api.revise`), as the composer did.
 */
import { useEffect, useMemo, useState } from 'react';
import AskIntent from '../../ui/AskIntent.jsx';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { mailApi } from '../../lib/api/mail.js';
import { BLOCKS, canDraft, cap, draftHoldLine, HOLD_READING, INTENTS, LENGTHS, TONES } from './emailModel.js';
import { BODY, BTN, Chips, ERROR, EYEBROW, MUTED, PRIMARY } from './emailParts.jsx';

export default function EmailDraftIntent({ person, refs = [], project = null, onAccept, onClose, api = mailApi }) {
  const intents = INTENTS[person.relationship] ?? [];
  const [intent, setIntent] = useState(intents[0]?.key ?? null);
  const [tone, setTone] = useState('warm');
  const [length, setLength] = useState('short');
  const [blocks, setBlocks] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [versions, setVersions] = useState([]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = useMemo(() => ({ person: person.ref, intent, tone, length, refs, blocks, ...(project ? { project } : {}) }),
    [person.ref, intent, tone, length, refs, blocks, project]);
  const draft = versions[at] ?? null;

  // The estimate before every draft (D1344: `estimate` runs nothing and charges nothing).
  useEffect(() => {
    let live = true;
    setEstimate(null);
    if (!intent) return undefined;
    api.estimate(ask).then((r) => { if (live) setEstimate(r?.estimate ?? null); })
      .catch((e) => { if (live) setError(e?.message || 'The estimate could not be read. Try again.'); });
    return () => { live = false; };
  }, [ask, api, intent]);

  const run = async (go) => {
    setBusy(true); setError(null);
    try { const r = await go(); if (r?.draft) { setVersions((v) => [...v, r.draft]); setAt(versions.length); } }
    catch (e) { setError(e?.status === 402 ? { line: e.message || 'Not enough AI tokens for this draft.', topUp: true } : (e?.message || 'Eadwyn could not draft this email. Try again.')); }
    finally { setBusy(false); }
  };
  const press = () => run(() => api.draft(ask));
  const shorter = () => draft && run(() => api.revise(draft.uid, { instruction: 'shorter', ...(project ? { project } : {}) }));
  const hold = draftHoldLine(estimate);
  const pressable = canDraft({ estimate, intent, busy });

  const footer = draft
    ? <span className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => onAccept?.({ ...draft, intent })} data-testid="email-intent-accept">Accept</button>
        <button type="button" className={BTN} disabled={busy} onClick={onClose} data-testid="email-intent-discard">Discard</button>
        <span className={`text-[12px] ${MUTED}`}>Accept places it in the Body. Nothing is sent until you press Send.</span>
      </span>
    : <span className="flex flex-col gap-1.5">
        <span className={`text-[12.5px] ${BODY}`} data-testid="email-intent-hold">{hold ?? HOLD_READING}</span>
        <button type="button" className={`${PRIMARY} self-start`} disabled={!pressable} onClick={press} data-testid="email-intent-draft">{busy ? 'Drafting…' : 'Draft'}</button>
      </span>;

  return (
    <AskIntent label={`Draft an email to ${person.name}`} title={`Email to ${person.name}`} footer={footer} onClose={onClose} testId="email-intent">
      {!draft ? (
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>What is it for</span>
            <Chips label="What is it for" testId="email-intent-intents" value={intent} onChange={setIntent} options={intents.map((i) => ({ value: i.key, label: i.label }))} /></section>
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Tone</span>
            <Chips label="Tone" value={tone} onChange={setTone} options={TONES.map((t) => ({ value: t, label: cap(t) }))} /></section>
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Length</span>
            <Chips label="Length" value={length} onChange={setLength} options={LENGTHS.map((l) => ({ value: l, label: cap(l) }))} /></section>
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Insert a live update</span>
            <span className="flex flex-wrap gap-1.5" data-testid="email-intent-blocks">{BLOCKS.map((b) => {
              const on = blocks.includes(b.value);
              return <button key={b.value} type="button" aria-pressed={on} className={BTN}
                onClick={() => setBlocks((x) => (on ? x.filter((v) => v !== b.value) : [...x, b.value]))}>{on ? '✓' : '+'} {b.label}</button>;
            })}</span></section>
        </div>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Preview" data-testid="email-intent-preview">
          <span className="flex items-center justify-between gap-2">
            <span className={EYEBROW}>Preview · version {at + 1} of {versions.length}</span>
            <span className="flex gap-1">
              <button type="button" className={BTN} aria-label="Previous version" disabled={at === 0} onClick={() => setAt(at - 1)}>‹</button>
              <button type="button" className={BTN} aria-label="Next version" disabled={at >= versions.length - 1} onClick={() => setAt(at + 1)}>›</button>
            </span>
          </span>
          <b className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="email-intent-subject">{draft.subject}</b>
          <p className={`m-0 whitespace-pre-wrap text-[12.5px] ${BODY}`} data-testid="email-intent-body">{draft.body}</p>
          <p className={`m-0 text-[12px] ${MUTED}`}>Used: {(draft.sources ?? []).map((s) => s.label).join(', ') || 'nothing'}. Nothing else was read.</p>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className={BTN} disabled={!pressable} onClick={press}>Regenerate</button>
            <button type="button" className={BTN} disabled={busy} onClick={shorter}>Shorter</button>
          </span>
          <span className={`text-[12px] ${MUTED}`}>{hold ?? HOLD_READING}</span>
        </section>
      )}
      {error ? <div className={ERROR} role="alert" data-testid="email-intent-error">
        {typeof error === 'string' ? error : error.line}
        {typeof error === 'object' && error.topUp ? <a href={ADD_TOKENS_PATH} className="ml-2 font-semibold underline">Top up</a> : null}
      </div> : null}
    </AskIntent>
  );
}
