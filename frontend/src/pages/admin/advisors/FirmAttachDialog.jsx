import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { refusalText } from '../partners/partnersDeskModel';
import { INPUT, Refusal, SUB } from '../partners/parts';
import { NOTHING_MATCHED, accountChoices, attachCopy, attachDone, firmChoices } from './firmsModel';

/**
 * D979 (#2765) — AP10: attaching an operating-partner account to a firm. The
 * strip's Attach fixes the account and asks for the firm; the drawer's
 * "Attach an account" fixes the firm and asks for the account. Either way the
 * admin chooses both and nothing is matched for them. The write is D952's
 * `POST /api/admin/partners/links`; a refusal stays inside the dialog.
 *
 * An account is known by its address when it has no name, from the same
 * admin-only links read as `FirmLinks.jsx` (README's one exception).
 */
export default function FirmAttachDialog({ links, account = null, firm = null, onClose, onDone }) {
  const [needle, setNeedle] = useState('');
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const copy = attachCopy({ account, firm });
  const choices = copy.pick === 'firm' ? firmChoices(links, needle) : accountChoices(links, needle);
  const pickWord = copy.pick === 'firm' ? 'Firm' : 'Account';
  const close = () => { if (!busy) onClose(); };

  const save = async () => {
    const acc = copy.pick === 'account' ? chosen.account : account;
    const target = copy.pick === 'firm' ? (links?.firms || []).find((f) => f.id === chosen.id) : firm;
    setBusy(true); setRefusal(null);
    try {
      await api.adminPartners.setFirmLink(acc.id, Number(target.id));
      onDone(attachDone(acc, target));
    } catch (e) {
      setRefusal(refusalText(e, 'firm'));
      setBusy(false);
    }
  };

  return (
    <Lightbox label={copy.title} title={copy.title} sub={copy.sub} onClose={close} testId="ap-attach-dialog"
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={save} disabled={busy || !chosen} data-testid="ap-attach-save">{busy ? 'Attaching…' : 'Attach'}</button>
          </div>
          <Refusal text={refusal} testId="ap-attach-refusal" />
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{pickWord}</span>
          <input type="search" value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder={copy.pick === 'firm' ? 'Search firms' : 'Search accounts'} className={INPUT} data-testid="ap-attach-search" />
        </label>
        <fieldset className="m-0 flex max-h-[320px] flex-col gap-1.5 overflow-y-auto border-0 p-0" data-testid="ap-attach-choices">
          <legend className="sr-only">{`Choose the ${pickWord.toLowerCase()}`}</legend>
          {choices.length === 0 ? <p className={`m-0 ${SUB}`} data-testid="ap-attach-none">{copy.pick === 'firm' ? 'No firm matches.' : 'No account without a firm matches.'}</p> : null}
          {choices.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-axal-hairline px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
              <input type="radio" name="ap-attach-choice" checked={chosen?.id === c.id} onChange={() => setChosen(c)} className="mt-0.5" data-testid={`ap-attach-choice-${c.id}`} />
              <span className="flex flex-col">
                <span className="font-bold">{c.title}</span>
                <span className={SUB}>{[c.sub, c.accounts].filter(Boolean).join(' · ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className={`m-0 ${SUB}`}>{NOTHING_MATCHED}</p>
      </div>
    </Lightbox>
  );
}
