/**
 * D1219 (#3216) — CP3, prepare the paper for one closing line, on D1216's
 * staged envelopes: choose the document, preview the text counsel has on file
 * with the fields it leaves open, fill them, and send it to be signed in
 * order (the company, the investor, then Axal's countersign last).
 *
 * - A document with no counsel text on file is a counsel draft: the Worker
 *   refuses its preview with its own sentence, and nothing is sent.
 * - A field is filled from a read where one gives it (the company from the
 *   deal, the investor and the purchase amount from the line), else typed.
 * - Eadwyn never fills money, and its proposals for the other fields are not
 *   read here yet.
 */
import { useState } from 'react';
import { stagedSigningApi } from '../../lib/api/closings';
import { Lightbox } from '../../ui';
import { BTN, INPUT } from '../account/AccountCenter';
import { Err, NotYet } from './ClosingDialogs';
import { DESK_WAITS, PAPERS, moneyCents, paperFields, signersFor } from './deskModel';

const refusal = (e, fallback) => (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback);
const EYEBROW = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-500 dark:text-gray-400';

export default function PaperDrawer({ closing, company, line, founderUserId, onClose, onSent }) {
  const known = PAPERS.some((p) => p.type === closing.template_slug);
  const [type, setType] = useState(known ? closing.template_slug : 'safe');
  const [preview, setPreview] = useState(null);
  const [fields, setFields] = useState([]);
  const [countersign, setCountersign] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const facts = { company, investor: line.investor_name, amountCents: line.amount_cents, currency: line.currency || closing.currency };
  const signers = signersFor({ founderUserId, investorUserId: line.investor_user_id });
  const values = Object.fromEntries(fields.filter((f) => String(f.value).trim()).map((f) => [f.key, String(f.value).trim()]));

  const choose = (t) => { setType(t); setPreview(null); setFields([]); setConfirm(false); setError(''); };
  const doPreview = async () => {
    setBusy(true); setError(''); setConfirm(false);
    try {
      const out = await stagedSigningApi.preview({ document_type: type, fields: values });
      setPreview(out);
      // Keep what was typed; a field newly left open takes its sourced value.
      setFields((prev) => paperFields(out?.unfilled, facts).map((f) => prev.find((p) => p.key === f.key && String(p.value).trim()) || f)
        .concat(prev.filter((p) => String(p.value).trim() && !(out?.unfilled || []).includes(p.key))));
    } catch (e) {
      setPreview(null);
      setError(refusal(e, 'The preview could not be read. Try again.'));
    } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError('');
    try {
      await stagedSigningApi.start({ deal_id: closing.deal_id, commitment_id: line.commitment_id, document_type: type, fields: values, signers, countersign });
      onSent?.();
    } catch (e) { setError(refusal(e, 'The paper could not be sent. Try again.')); setConfirm(false); } finally { setBusy(false); }
  };
  const setField = (key, value) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, value, from: null } : f)));
  const open = fields.filter((f) => !String(f.value).trim());
  const amount = moneyCents(line.amount_cents, line.currency || closing.currency);
  const amountField = fields.find((f) => f.money && f.from === 'From the line');
  const sendable = !!preview?.sendable && open.length === 0 && signers.length === 2;

  return (
    <Lightbox label="Prepare the paper" eyebrow="Step 1 · Paper" title="Prepare the paper" sub={`${line.investor_name || 'This line'} · ${amount || 'Amount not recorded'}`}
      testId="closing-paper-drawer" onClose={onClose} width={620}>
      <div className="flex flex-col gap-4 px-5 py-4 text-[12.5px]">
        <section className="flex flex-col gap-1.5" aria-label="Template">
          <span className={EYEBROW}>Template</span>
          {['Portfolio', 'Fund'].map((g) => (
            <div key={g} className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{g}</span>
              {PAPERS.filter((p) => p.group === g).map((p) => (
                <label key={p.type} className="flex items-center gap-2" data-testid={`closing-paper-type-${p.type}`}>
                  <input type="radio" name="paper" checked={type === p.type} onChange={() => choose(p.type)} />{p.label}
                </label>
              ))}
            </div>
          ))}
          <p className="m-0 text-[12px] text-gray-600 dark:text-gray-400">A document with no counsel text on file is a counsel draft: it is never sent from here.</p>
        </section>

        {preview && (
          <section className="flex flex-col gap-2" aria-label="Fields" data-testid="closing-paper-fields">
            <span className={EYEBROW}>Fields · {preview.title}</span>
            {fields.length === 0 && <p className="m-0 text-gray-600 dark:text-gray-400">Counsel’s text leaves no field open.</p>}
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1" data-testid={`closing-paper-field-${f.key}`}>
                <span className="flex items-center justify-between gap-2 font-semibold">{f.label}<span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">{f.from || (String(f.value).trim() ? 'Typed' : 'Not recorded')}</span></span>
                <input className={INPUT} value={f.value} onChange={(e) => setField(f.key, e.target.value)} />
                {f.money && !String(f.value).trim() && <span className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid={`closing-paper-money-${f.key}`}>Eadwyn never fills money. Record it on the deal or the line.</span>}
              </label>
            ))}
            {amountField && amount && amountField.value === amount && <p className="m-0 text-emerald-700 dark:text-emerald-300" data-testid="closing-paper-amount-match">The paper’s amount matches the line: {amount}.</p>}
            <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-gray-300 p-2.5 dark:border-gray-700" data-testid="closing-paper-eadwyn"><NotYet />
              <span className="text-gray-600 dark:text-gray-400">{DESK_WAITS.eadwyn}</span></div>
          </section>
        )}

        <section className="flex flex-col gap-1.5" aria-label="Signers, in order" data-testid="closing-paper-signers">
          <span className={EYEBROW}>Signers, in order</span>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
            <li>The company{founderUserId ? '' : <span className="text-red-700 dark:text-red-300" data-testid="closing-paper-no-founder"> · The company’s signer is not recorded on this deal, so the paper cannot be sent.</span>}</li>
            <li>{line.investor_name || 'The investor'}{line.investor_user_id ? '' : <span className="text-red-700 dark:text-red-300"> · This line has no investor account, so the paper cannot be sent.</span>}</li>
            {countersign && <li>Axal countersign · a Super Admin, always last</li>}
          </ol>
          <label className="flex items-center gap-2"><input type="checkbox" checked={countersign} onChange={(e) => { setCountersign(e.target.checked); setConfirm(false); }} data-testid="closing-paper-countersign" />Axal countersigns last</label>
          <span className="text-[12px] text-gray-600 dark:text-gray-400">Signed on StudioOS’s own envelopes. Each signer is sent the paper when the one before has signed.</span>
        </section>

        {preview?.line && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="closing-paper-draft">{preview.line}</p>}
        {preview && open.length > 0 && <p className="m-0 text-gray-600 dark:text-gray-400" data-testid="closing-paper-open">{open.length} field{open.length === 1 ? '' : 's'} still open. Preview again once they are filled.</p>}
        {confirm && (
          <p className="m-0 rounded-lg bg-violet-50 px-3 py-2 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100" data-testid="closing-paper-confirm-line">
            This sends {preview?.title || 'the paper'} to the company to sign first. The same text goes to every signer; it cannot be changed once sent.
          </p>
        )}
        <Err text={error} testId="closing-paper-error" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">
        <span className="mr-auto text-[12px] text-gray-600 dark:text-gray-400">Send for signature opens after a preview with every field filled.</span>
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={confirm || sendable ? BTN.ghost : BTN.primary} disabled={busy} onClick={doPreview} data-testid="closing-paper-preview">{preview ? 'Preview again' : 'Preview'}</button>
        {!confirm
          ? <button type="button" className={BTN.primary} disabled={busy || !sendable} onClick={() => setConfirm(true)} data-testid="closing-paper-send">Send for signature</button>
          : <button type="button" className={BTN.primary} disabled={busy} onClick={send} data-testid="closing-paper-send-confirm">Send it</button>}
      </div>
    </Lightbox>
  );
}
