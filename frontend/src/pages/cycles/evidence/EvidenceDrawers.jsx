/**
 * D1266 (#3289) — the claim drawer (VR2) and the evidence item drawer (VR3), at
 * `/raise/evidence/claim/:id` and `/raise/evidence/item/:id`, over the view.
 *
 * The claim drawer shows both figures and both sources: the one the founder
 * states and the one the record holds. Neither is presumed right. Linking and
 * unlinking evidence are the founder's, each through a dialog that says what
 * it changes; the next read checks the claim again (D1264 §4).
 *
 * The item drawer shows where an item came from, what it backs, and who sees
 * it. Sharing, Confirm (a changed source) and Unpin each open a dialog first.
 * A reader (a studio admin) sees the same drawers with no control.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { BASE, SHARING, claimHref, itemHref } from './evidenceModel';
import {
  AREA_HREF, SURFACES, claimTitle, claimWhere, day, itemFigure, itemTitle, sharingChange, statedFigure,
} from './evidenceView';
import {
  BTN_D, BTN_L, BTN_S, ChangeDialog, ChangedPill, Drawer, LINK, MUTED, Section, SharingPill, SourcePill, StalePill, StatePill, StrengthMark,
} from './EvidenceParts';

const HOW = { computed: 'Found by the check', founder: 'Linked by you', eadwyn_accepted: 'Proposed by Eadwyn, accepted by you' };

function Missing({ what, closeTo, testId }) {
  return (
    <Drawer label={what} title={what} closeTo={closeTo} testId={testId}>
      <Section><p className={MUTED} data-testid={`${testId}-missing`}>This {what.toLowerCase()} is not among the evidence read for this venture. It may have been removed, or belong to another venture.</p></Section>
    </Drawer>
  );
}

/** VR2: one claim, its two figures, and the evidence linked to it. */
export function ClaimDrawer({ id, model, search = '', projectId, onChanged }) {
  const closeTo = `${BASE}${search}`;
  const claim = (model.claims || []).find((c) => c.uid === id);
  const [dialog, setDialog] = useState(null);
  if (!model.claims) return null;
  if (!claim) return <Missing what="Claim" closeTo={closeTo} testId="evidence-drawer-claim" />;
  const surface = SURFACES[claim.surface];
  const rec = claim.record;
  const links = claim.links || [];
  const linkable = (model.items || []).filter((i) => i.state === 'pinned' && !links.some((l) => l.item_uid === i.uid));
  const run = (fn) => async () => { await fn(); await onChanged?.(); };
  return (
    <Drawer label="Claim" eyebrow={claimWhere(claim)} title={claimTitle(claim)} closeTo={closeTo} testId="evidence-drawer-claim"
      footer={model.canDecide ? (
        <>
          <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'link' })} disabled={!linkable.length} data-testid="claim-link-evidence">Link evidence</button>
          {surface ? <Link to={`${surface.href}${search}`} className={BTN_S}>Open the {surface.label.toLowerCase()}</Link> : null}
        </>
      ) : null}>
      <Section>
        <div className="flex flex-wrap items-center gap-2"><StatePill state={claim.state} /></div>
      </Section>
      <Section title={claim.state === 'mismatch' ? 'Two figures, two sources' : 'The figure and its record'} testId="claim-figures">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">You state</span>
            <span className="text-[17px] font-bold text-axal-ink dark:text-gray-100" data-testid="claim-stated">{statedFigure(claim) ?? 'Not a figure'}</span>
            <SourcePill source="typed" rest={claimWhere(claim)} />
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">The record says</span>
            {rec ? (
              <>
                <span className="text-[17px] font-bold text-axal-ink dark:text-gray-100" data-testid="claim-record">{rec.shown ?? 'Recorded, with no figure'}</span>
                <SourcePill source={rec.source_label} provider={rec.provider} on={rec.observed_on} />
              </>
            ) : <span className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="claim-record">Not recorded. No pinned record measures this claim.</span>}
          </div>
        </div>
        {claim.state === 'mismatch' ? <p className={MUTED}>Neither figure is presumed right. If what you state is current, the record is what to correct.</p> : null}
        {claim.state === 'founders_figure' ? <p className={MUTED}>Only a figure you typed agrees, so this is your figure, not Backed. A connector, a document, a recording or a signature backs it.</p> : null}
      </Section>
      <Section title="Evidence linked to this claim" testId="claim-links">
        {links.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {links.map((l) => {
              const item = model.byUid.get(l.item_uid);
              return (
                <li key={l.item_uid} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="flex flex-col gap-0.5">
                    <Link to={itemHref(l.item_uid, search)} className={LINK}>{item ? itemTitle(item) : 'An evidence item'}</Link>
                    <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{HOW[l.how] || 'Linked'}</span>
                  </span>
                  {model.canDecide && l.how !== 'computed'
                    ? <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'unlink', item, uid: l.item_uid })} data-testid="claim-unlink">Unlink</button> : null}
                </li>
              );
            })}
          </ul>
        ) : <p className={MUTED}>No evidence is linked to this claim yet.</p>}
      </Section>
      <Section>
        <p className={MUTED} data-testid="claim-checked">{claim.checked_at ? `Checked ${day(claim.checked_at)}` : 'Not checked yet: the next read of this page checks it.'}</p>
      </Section>
      {dialog?.kind === 'link' ? (
        <LinkDialog claim={claim} items={linkable} onClose={() => setDialog(null)}
          onLink={(item) => run(() => raiseEvidenceApi.link(projectId, claim.uid, item.uid, item.version))()} />
      ) : null}
      {dialog?.kind === 'unlink' ? (
        <ChangeDialog title="Unlink this evidence?" confirm="Unlink" onClose={() => setDialog(null)}
          says={`${dialog.item ? itemTitle(dialog.item) : 'This item'} stops backing ${claimTitle(claim)}. The claim is checked again on the next read.`}
          onConfirm={run(() => raiseEvidenceApi.unlink(projectId, claim.uid, dialog.uid))} testId="claim-unlink-dialog" />
      ) : null}
    </Drawer>
  );
}

/** Pick one pinned item, then the dialog says what linking it changes. */
function LinkDialog({ claim, items, onLink, onClose }) {
  const [uid, setUid] = useState(items[0]?.uid || '');
  const item = items.find((i) => i.uid === uid);
  return (
    <ChangeDialog title="Link evidence to this claim?" confirm="Link" onClose={onClose} testId="claim-link-dialog"
      says={item ? `${itemTitle(item)} will back ${claimTitle(claim)}. Linking does not change what the record says; the claim is checked again on the next read.` : 'Choose a pinned item.'}
      onConfirm={() => (item ? onLink(item) : Promise.reject(new Error('Choose a pinned item.')))}>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
        Evidence
        <select value={uid} onChange={(e) => setUid(e.target.value)} className="rounded-lg border border-axal-hairline bg-white px-2 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="claim-link-pick">
          {items.map((i) => <option key={i.uid} value={i.uid}>{itemTitle(i)}{day(i.observed_on) ? ` · ${day(i.observed_on)}` : ''}</option>)}
        </select>
      </label>
    </ChangeDialog>
  );
}

/** VR3: one item, where it came from, what it backs, and who sees it. */
export function ItemDrawer({ id, model, search = '', projectId, onChanged }) {
  const closeTo = `${BASE}${search}`;
  const item = model.byUid.get(id);
  const [dialog, setDialog] = useState(null);
  if (!model.items) return null;
  if (!item) return <Missing what="Evidence item" closeTo={closeTo} testId="evidence-drawer-item" />;
  const backs = (model.claims || []).filter((c) => (c.links || []).some((l) => l.item_uid === id));
  const value = itemFigure(item);
  const run = (fn) => async () => { await fn(); await onChanged?.(); };
  const patch = (body) => run(() => raiseEvidenceApi.update(projectId, item.uid, item.version, body));
  const module = AREA_HREF[item.area];
  return (
    <Drawer label="Evidence item" eyebrow={`Evidence · ${item.area}`} title={itemTitle(item)} closeTo={closeTo} testId="evidence-drawer-item"
      footer={(
        <>
          {module ? <Link to={`${module}${search}`} className={BTN_S}>Open in {item.area}</Link> : null}
          {model.canDecide && item.state === 'pinned' ? <button type="button" className={BTN_D} onClick={() => setDialog({ kind: 'unpin' })} data-testid="item-unpin">Unpin</button> : null}
          {model.canDecide && item.state === 'unpinned' ? <button type="button" className={BTN_L} onClick={() => setDialog({ kind: 'pin' })} data-testid="item-pin">Pin again</button> : null}
        </>
      )}>
      <Section>
        <div className="flex flex-wrap items-center gap-2">
          <SourcePill source={item.source_label} provider={item.provider} on={item.observed_on} />
          <StrengthMark strength={item.strength} />
          {item.stale ? <StalePill /> : null}
          {item.state === 'unpinned' ? <span className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">Unpinned</span> : null}
        </div>
      </Section>
      <Section title="Where it came from" testId="item-source">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{item.summary}</p>
        {value ? <p className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100" data-testid="item-value">{value}</p> : null}
        <p className={MUTED} data-testid="item-date">{day(item.observed_on) ? `Dated ${day(item.observed_on)}, the record’s own date.` : item.date_reason || 'The record’s date is not recorded.'}</p>
        {item.source_state === 'unreadable' ? <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-300">Its source could not be read just now. It shows its last known date.</p> : null}
        {item.source_state === 'not_recorded' ? <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-300">Its source record is no longer found. Investors see nothing of it until it is.</p> : null}
        {item.private_reason === 'bank' ? <p className={MUTED}>From the company’s bank. Shared as a figure only: balances, accounts and bank lines are never shown.</p> : null}
        {item.private_reason === 'quote' ? <p className={MUTED}>A quote. It is shared only while the person’s consent to be quoted stands.</p> : null}
      </Section>
      {item.source_state === 'changed' ? (
        <Section testId="item-changed">
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
            <ChangedPill />
            <p className="m-0 text-[12.5px] text-amber-900 dark:text-amber-200">The record changed since you pinned it. Investors see nothing of it until you confirm the current record.</p>
            {model.canDecide ? <button type="button" className={`${BTN_S} w-fit`} onClick={() => setDialog({ kind: 'confirm' })} data-testid="item-confirm">Confirm</button> : null}
          </div>
        </Section>
      ) : null}
      <Section title="Backs" testId="item-backs">
        {backs.length ? (
          <div className="flex flex-wrap gap-2">{backs.map((c) => <Link key={c.uid} to={claimHref(c.uid, search)} className="rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">{claimTitle(c)} · {claimWhere(c)}</Link>)}</div>
        ) : <p className={MUTED}>No claim is linked to this item yet. A claim drawer links it.</p>}
      </Section>
      <Section title="Sharing" testId="item-sharing">
        {model.canDecide ? (
          <div role="radiogroup" aria-label="Sharing" className="inline-flex w-fit rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700">
            {Object.entries(SHARING).map(([k, w]) => (
              <button key={k} type="button" role="radio" aria-checked={item.visibility === k} disabled={item.state !== 'pinned'}
                onClick={() => (item.visibility === k ? null : setDialog({ kind: 'share', to: k }))} data-testid={`item-share-${k}`}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${item.visibility === k ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>{w}</button>
            ))}
          </div>
        ) : <SharingPill visibility={item.visibility} />}
      </Section>
      {dialog?.kind === 'share' ? (() => {
        const change = sharingChange(item, dialog.to);
        return <ChangeDialog title={change.title} says={change.says} confirm="Share" onClose={() => setDialog(null)} onConfirm={patch({ visibility: dialog.to })} testId="item-share-dialog" />;
      })() : null}
      {dialog?.kind === 'confirm' ? (
        <ChangeDialog title="Confirm the current record?" confirm="Confirm" onClose={() => setDialog(null)} testId="item-confirm-dialog"
          says={`${itemTitle(item)} takes the record as it stands now, and investors see it at its current sharing. Claims it backs are checked again.`}
          onConfirm={patch({ confirm_current: true })} />
      ) : null}
      {dialog?.kind === 'unpin' ? (
        <ChangeDialog title="Unpin this evidence?" confirm="Unpin" danger onClose={() => setDialog(null)} testId="item-unpin-dialog"
          says={`${itemTitle(item)} stops backing your Raise. Investors no longer see it, and claims it backs are checked again.`}
          onConfirm={patch({ state: 'unpinned' })} />
      ) : null}
      {dialog?.kind === 'pin' ? (
        <ChangeDialog title="Pin this evidence again?" confirm="Pin" onClose={() => setDialog(null)} testId="item-pin-dialog"
          says={`${itemTitle(item)} backs your Raise again at ${SHARING[item.visibility] || 'its'} sharing, if its record has not changed.`}
          onConfirm={patch({ state: 'pinned' })} />
      ) : null}
    </Drawer>
  );
}
