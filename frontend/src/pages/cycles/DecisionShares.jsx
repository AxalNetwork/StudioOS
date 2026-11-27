/**
 * D6862 (#6862, D6021 V19, V19B, V21, V22 C, V23 B; owner answers Q1 B, Q2 A,
 * Q3 A) — under a decision record's Memo section: who the decision is shared
 * with, Revoke, and Share with…, the sheet that picks the venture's named
 * Operating Partners and investors, says what they will and will not see, and
 * includes the reasoning only when ticked. A Withheld decision says it cannot
 * be shared. Reads and writes `routes/verdict_shares.ts`; the Worker decides
 * who may share and with whom.
 *
 * States (V21): loading, the list Unavailable with Try again (Share off until
 * it reads), Share saving and failed with the selection kept, Revoke saving
 * and failed with the person still listed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox.jsx';
import { Unreadable } from '../../ui/Honesty.jsx';
import { decisionSharesApi } from '../../lib/api/decisionShares.js';
import { ventureRef } from './ventureQuery.js';
import { useRecordPhone } from './RecordView.jsx';
import { dayMonth, sharedDecisionPath } from './verdictEvidenceModel.js';

const BTN = 'inline-flex min-h-9 items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-lg:min-h-11';
const PRIMARY = 'inline-flex min-h-9 items-center justify-center rounded-[9px] bg-axal-violet px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600 max-lg:min-h-[52px]';
const EYEBROW = 'text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400';
const ALERT = 'rounded-[10px] border border-red-200 bg-red-50 p-2.5 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const KIND = { partner: 'Operating Partner', investor: 'Investor' };
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function CopyLink({ decision }) {
  const [done, setDone] = useState(false);
  return <button type="button" className={BTN} onClick={async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${sharedDecisionPath(decision)}`); setDone(true); } catch { setDone(false); }
  }}>{done ? 'Link copied' : 'Copy link'}</button>;
}

function ShareRow({ share, canRevoke, revoking, onRevoke, decision = null }) {
  return <div className="flex items-center gap-2.5 py-1.5" data-testid="decision-share-row">
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-axal-lavender text-[11px] font-bold text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300">{initials(share.recipient_name)}</span>
    <div className="min-w-0 flex-1"><b className="block text-[12.5px] text-axal-ink dark:text-gray-100">{share.recipient_name}</b>
      <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{KIND[share.recipient_kind] ?? 'Named person'} · shared {dayMonth(share.shared_at) ?? 'on an unrecorded date'}
        {share.include_reasoning ? ' · reasoning included' : ''}{share.revoked_at ? ` · revoked ${dayMonth(share.revoked_at) ?? ''}` : ''}</small></div>
    {share.revoked_at ? <span className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">Revoked</span>
      : canRevoke ? <span className="flex gap-1.5">{decision != null && <CopyLink decision={decision} />}
        <button type="button" className={BTN} disabled={revoking} onClick={() => onRevoke(share)}>{revoking ? 'Revoking…' : 'Revoke'}</button></span> : null}
  </div>;
}

function ShareSheet({ project, decision, title, live, onClose, onShared }) {
  const [read, setRead] = useState({ status: 'loading', candidates: [] });
  const [picked, setPicked] = useState(() => new Set());
  const [reasoning, setReasoning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setRead({ status: 'loading', candidates: [] });
    decisionSharesApi.candidates(project, decision).then((r) => setRead({ status: 'ready', candidates: Array.isArray(r?.candidates) ? r.candidates : [] }),
      () => setRead({ status: 'unreadable', candidates: [] }));
  }, [project, decision]);
  useEffect(() => { load(); }, [load]);
  const toggle = (id) => setPicked((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const share = async () => {
    if (!picked.size || saving) return;
    setSaving(true); setError('');
    try {
      const r = await decisionSharesApi.grant(project, decision, { recipients: [...picked], include_reasoning: reasoning });
      onShared(r?.shares ?? []);
      onClose();
    } catch (e) {
      // The selection and the tick stay as chosen.
      setError(e?.message || 'Nobody was given access.');
    } finally { setSaving(false); }
  };
  const groups = [['partner', 'Operating Partners'], ['investor', 'Investors']];
  const n = picked.size;
  const footer = <div className="flex flex-wrap items-center justify-between gap-2.5 max-lg:flex-col max-lg:items-stretch">
    <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Access to this one decision, not a file. Revoke at any time.</span>
    <div className="flex gap-2 max-lg:flex-col">
      <button type="button" className={BTN} onClick={onClose} disabled={saving}>Cancel</button>
      <button type="button" className={PRIMARY} onClick={share} disabled={!n || saving || read.status !== 'ready'} data-testid="decision-share-submit">
        {saving ? 'Sharing…' : n ? `Share with ${n} ${n === 1 ? 'person' : 'people'}` : 'Choose who to share with'}</button>
    </div>
  </div>;
  return <Lightbox label="Share this decision" eyebrow={title} title="Share this decision" onClose={saving ? () => {} : onClose} footer={footer} pageBelow="lg" width={620} testId="decision-share-sheet">
    <div className="flex flex-col gap-3.5 px-5 py-4">
      {read.status === 'loading' && <div aria-busy="true" className="flex flex-col gap-2">{[60, 90, 75].map((w) => <span key={w} className="h-3 animate-pulse rounded bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}</div>}
      {read.status === 'unreadable' && <Unreadable what="The people you can share with" claim="This is not a claim that the venture has none." onRetry={load} size="block" />}
      {read.status === 'ready' && <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYEBROW + ' mb-1'}>Named people at this venture</legend>
        {read.candidates.length === 0 && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">No Operating Partner or investor is named at this venture yet. A partner is added on the team page; an investor through a deal room or an introduction.</p>}
        {groups.map(([kind, label]) => {
          const list = read.candidates.filter((c) => c.kind === kind);
          return list.length ? <div key={kind} className="flex flex-col gap-1"><span className={EYEBROW}>{label}</span>
            {list.map((c) => <label key={c.user_id} className={'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-1.5 text-[12.5px] ' + (c.shared || picked.has(c.user_id)
              ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900')}>
              <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={c.shared || picked.has(c.user_id)} disabled={c.shared || saving} onChange={() => toggle(c.user_id)} />
              <span className="min-w-0 flex-1"><b className="block text-axal-ink dark:text-gray-100">{c.name}</b><small className="text-axal-muted dark:text-gray-400">{KIND[c.kind]}</small></span>
              {c.shared && <span className="text-[11px] text-axal-muted dark:text-gray-400">already shared</span>}
            </label>)}</div> : null;
        })}
      </fieldset>}
      <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-axal-hairline bg-axal-ground p-3 text-[12.5px] dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-2">
        <div><span className={EYEBROW}>They will see</span><ul className="m-0 mt-1 list-disc pl-4 text-axal-ink dark:text-gray-200">
          <li>This one decision: {title}</li><li>Its evidence list, with directions and what counted</li><li>Its commitments</li><li>The reasoning, only if you tick it below</li></ul></div>
        <div><span className={EYEBROW}>They will not see</span><ul className="m-0 mt-1 list-disc pl-4 text-axal-ink dark:text-gray-200">
          <li>Other decisions, including Withheld ones</li><li>Interviews, transcripts and hypotheses</li><li>Your Eadwyn conversations</li></ul></div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[12.5px]">
        <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={reasoning} disabled={saving} onChange={(e) => setReasoning(e.target.checked)} data-testid="decision-share-reasoning" />
        <span><b className="block text-axal-ink dark:text-gray-100">Include reasoning</b><small className="text-axal-muted dark:text-gray-400">Off unless you tick it, for each share</small></span>
      </label>
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">They open it in StudioOS after signing in, at its own read-only page.</p>
      {error && <div role="alert" className={ALERT}><b>Couldn’t share.</b> {error} Your selection is kept. Try again.</div>}
      {live.length > 0 && <div><span className={EYEBROW}>Shared with · {live.length}</span>{live.map((s) => <ShareRow key={s.uid} share={s} canRevoke={false} />)}</div>}
    </div>
  </Lightbox>;
}

export default function DecisionShares({ record }) {
  const location = useLocation();
  const project = ventureRef(location.search)?.id ?? null;
  const decision = record?.id;
  const phone = useRecordPhone();
  const [read, setRead] = useState({ status: 'loading' });
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [revokeError, setRevokeError] = useState(null);
  const opener = useRef(null);
  const load = useCallback(() => {
    if (!project || decision == null) { setRead({ status: 'unreadable' }); return; }
    setRead({ status: 'loading' });
    decisionSharesApi.list(project, decision).then((r) => setRead({ status: 'ready', ...r }), () => setRead({ status: 'unreadable' }));
  }, [project, decision]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (share) => {
    setRevoking(share.uid); setRevokeError(null);
    try { const r = await decisionSharesApi.revoke(project, decision, share.uid); setRead((old) => ({ ...old, shares: r?.shares ?? old.shares })); }
    catch (e) { setRevokeError({ name: share.recipient_name, message: e?.message }); }
    finally { setRevoking(null); }
  };
  const title = String(record?.title || 'this decision');
  const shares = Array.isArray(read.shares) ? read.shares : [];
  const live = shares.filter((s) => !s.revoked_at);
  const box = phone ? 'flex flex-col gap-2 pt-1' : 'flex flex-col gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-700';
  if (read.status === 'loading') return <div className={box} aria-busy="true" data-testid="decision-shares"><span className="h-3 w-1/2 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></div>;
  if (read.status === 'unreadable') return <div className={box} data-testid="decision-shares">
    <Unreadable what="Who this decision is shared with" claim="Share stays off until it reads." onRetry={load} size="block" />
    <button type="button" className={BTN + ' self-start'} disabled>Share with…</button></div>;
  if (!read.shareable) return <div className={box} data-testid="decision-shares"><p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400"><span aria-hidden="true">🔒 </span>A withheld decision cannot be shared.</p></div>;
  return <div className={box} data-testid="decision-shares">
    {read.can_share && <button ref={opener} type="button" className={BTN + ' self-start'} onClick={() => setOpen(true)} data-testid="decision-share-open">Share with…</button>}
    <span className={EYEBROW}>Shared with{live.length ? ` · ${live.length}` : ''}</span>
    {shares.length === 0 ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">Not shared with anyone yet.</p>
      : shares.map((s) => <ShareRow key={s.uid} share={s} canRevoke={!!read.can_share} revoking={revoking === s.uid} onRevoke={revoke} decision={decision} />)}
    {revokeError && <div role="alert" className={ALERT}><b>Couldn’t revoke.</b> {revokeError.name} still has access. Try again.</div>}
    {open && <ShareSheet project={project} decision={decision} title={title} live={live} onClose={() => { setOpen(false); opener.current?.focus?.(); }}
      onShared={(list) => setRead((old) => ({ ...old, shares: list }))} />}
  </div>;
}
