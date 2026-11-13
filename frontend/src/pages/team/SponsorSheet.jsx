import React, { useEffect, useState } from 'react';
import { Lightbox, Unrecorded } from '../../ui';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, HonestBlock, MUTED } from './teamUi.jsx';
import { SPONSOR_REASON_MIN } from './teamModel.js';

/**
 * D4387 (#4387, #3742 E8) — Choose a new sponsor: TM9b's fix for an agent
 * paused because its sponsor lost access, and the profile's "Change sponsor".
 *
 * The team's members come from `agentsAdapter.sponsorCandidates` (`GET
 * /api/teams/agents/:uid/sponsors`), each with whether the Worker lets them
 * sponsor this agent and, when not, why in its words: off the team, not an
 * editor, no paid Founder plan, no AI tokens. Only a member who can is
 * offered. Save sends the member and a reason of at least 10 characters
 * through `changeSponsor`; a refusal is drawn in the Worker's words. An agent
 * with read tools changes sponsor only once the manager ticks that its tools
 * are dropped (they are the old sponsor's own servers). No canvas draws this
 * dialog; it uses the Edit-cap dialog's frame.
 */
export default function SponsorSheet({ uid, name, toolCount = 0, onCancel, onSaved }) {
  const [block, setBlock] = useState(null);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [dropTools, setDropTools] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { let alive = true; agents.sponsorCandidates(uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [uid]);
  const candidates = block?.available && Array.isArray(block.value?.candidates) ? block.value.candidates : [];
  const able = candidates.filter((m) => m.can_sponsor);
  const ok = !!pick && reason.trim().length >= SPONSOR_REASON_MIN && (!toolCount || dropTools) && !saving;
  const save = async () => {
    setRefusal(''); setSaving(true);
    const out = await agents.changeSponsor(uid, { sponsorUid: pick, reason: reason.trim(), dropTools: !!toolCount && dropTools });
    setSaving(false);
    if (!out.available) { setRefusal(out.unreadable ? 'The sponsor could not be changed. Try again.' : out.reason); return; }
    onSaved?.(out.value?.agent || null);
  };
  return (
    <Lightbox label={`Choose a new sponsor for ${name}`} title={`Choose a new sponsor for ${name}`} onClose={onCancel} width={520} testId="agent-sponsor-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onCancel}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!ok} onClick={save} data-testid="agent-sponsor-save">Save sponsor</button>
        </div>
      )}>
      <p className={`m-0 mb-3 ${MUTED}`}>The sponsor’s AI tokens pay for this agent’s runs, up to its monthly cap. A sponsor is one of this team’s editors on a paid Founder plan with AI tokens.</p>
      {!block ? <p className={`m-0 ${MUTED}`}>Reading…</p>
        : !block.available ? <HonestBlock>{block.unreadable ? 'This team’s members could not be read.' : block.reason}</HonestBlock>
          : (
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="agent-sponsor-candidates">
              <legend className="mb-1 text-[13px] font-bold text-axal-ink dark:text-gray-100">New sponsor</legend>
              {candidates.map((m) => (
                <label key={m.uid} className={`flex items-start gap-2 rounded-axal-md border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-700 ${m.can_sponsor ? 'cursor-pointer text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}
                  data-testid={`agent-sponsor-option-${m.uid}`}>
                  <input type="radio" name="sponsor" value={m.uid} disabled={!m.can_sponsor} checked={pick === m.uid} onChange={() => setPick(m.uid)} className="mt-0.5" />
                  <span className="flex flex-col">
                    <span className="font-semibold">{String(m.name || '').trim() || <Unrecorded />}</span>
                    {m.current ? <span className={MUTED}>Sponsors it now</span> : m.reason ? <span className={MUTED}>{m.reason}</span> : null}
                  </span>
                </label>
              ))}
              {!able.length ? <p className={`m-0 ${MUTED}`} data-testid="agent-sponsor-none">No one else on this team can sponsor it now.</p> : null}
            </fieldset>
          )}
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Why</span>
        <textarea rows={3} maxLength={500} className="w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13.5px] text-axal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="agent-sponsor-reason" />
        <span className={MUTED}>At least {SPONSOR_REASON_MIN} characters. It is kept in the agent’s activity.</span>
      </label>
      {toolCount ? (
        <label className="mt-3 flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={dropTools} onChange={(e) => setDropTools(e.target.checked)} className="mt-0.5" data-testid="agent-sponsor-drop-tools" />
          <span>Drop its {toolCount === 1 ? 'read tool' : `${toolCount} read tools`}. {toolCount === 1 ? 'It is' : 'They are'} on the current sponsor’s own connected servers, which a new sponsor cannot use.</span>
        </label>
      ) : null}
      {refusal ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="agent-sponsor-refusal">{refusal}</p> : null}
    </Lightbox>
  );
}
