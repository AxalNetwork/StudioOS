/**
 * D6184 (#6184) — one envelope on the Documents tab's "Deal paper" card (DL8): its title, status and signed
 * count, and what the viewer can do with it. A fully signed envelope offers Download, which reads
 * `GET /api/legal/esign/:id/document` and shows the Worker's refusal in the row when it refuses. An open one
 * reads `GET /api/legal/esign/:id` to say how to sign: that read never returns a signing link, so the row
 * says the link was sent by email and no signing URL is ever built in the browser. The words are
 * `dealWorkModel.js`'s.
 *
 * D6197 (#6197): when the envelope waits on the viewer, "Send me the link again" asks the Worker to email the
 * viewer's own link once more (`POST /api/legal/esign/:id/resend`, the viewer's own pending row, once an hour); the
 * answer never carries the link, and a refusal is drawn as the Worker's sentence.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Unreadable } from '../../ui';
import { api, rawRequestHeaders, refusalError } from '../../lib/api';
import { closingsApi } from '../../lib/api/closings';
import { reportError } from '../../lib/log';
import { useAuth } from '../../hooks/useAuthSync';
import { SUB } from './DealFrame';
import { PAPER_CLOSED_LINE, PAPER_WAIT_DOWNLOAD, PAPER_WORDS, paperSigning } from './dealWorkModel';

const PILL = {
  done: 'border-axal-positive/40 bg-axal-positive/10 text-axal-positive dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  wait: 'border-axal-amber/40 bg-axal-amber/10 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  off: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const LINK = 'text-[12.5px] font-bold text-axal-violet-deep underline disabled:opacity-60 dark:text-violet-300';

/** The signed copy, through the Worker: a refusal is thrown with the Worker's own words. */
async function downloadSigned(id) {
  const res = await fetch(api.esignDocumentUrl(id), { credentials: 'include', headers: rawRequestHeaders('GET') });
  if (!res.ok) throw await refusalError(res, 'The signed copy did not download. Try again.');
  const blob = await res.blob();
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `axal-envelope-${id}.pdf`;
  document.body.appendChild(a);
  a.click?.();
  a.remove?.();
  URL.revokeObjectURL?.(url);
}

export default function DealPaperRow({ row }) {
  const { user } = useAuth() || {};
  const [detail, setDetail] = useState({ status: row.action === 'sign' ? 'loading' : 'idle' });
  const serial = useRef(0);
  useEffect(() => () => { serial.current += 1; }, []);
  const loadDetail = () => {
    if (row.action !== 'sign') return;
    const mine = ++serial.current;
    setDetail({ status: 'loading' });
    api.esignDetail(row.id).then((data) => { if (serial.current === mine) setDetail({ status: 'ready', data }); })
      .catch((e) => { reportError('DealWork:envelope', e); if (serial.current === mine) setDetail({ status: 'unreadable' }); });
  };
  useEffect(loadDetail, [row.id, row.action]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dl, setDl] = useState({});
  const download = async () => {
    setDl({ busy: true });
    try { await downloadSigned(row.id); setDl({}); } catch (e) { setDl({ err: e?.message || 'The signed copy did not download. Try again.' }); }
  };
  const [again, setAgain] = useState({});
  const resend = async () => {
    setAgain({ busy: true });
    try { await closingsApi.resendSigningLink(row.id); setAgain({ sent: true }); } catch (e) { setAgain({ err: e?.message || PAPER_WORDS.resendFailed }); }
  };
  const signing = row.action === 'sign' ? paperSigning(detail, user?.email) : null;
  return (
    <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="deal-paper-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{row.title}</span>
        <span className={`inline-flex items-center rounded-axal-pill border px-2 py-0.5 text-[11.5px] font-bold ${PILL[row.tone] || PILL.off}`}>{row.state}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="deal-paper-signed">{row.signed}</span>
        {row.action === 'download' && (
          <button type="button" className={LINK} disabled={dl.busy} onClick={download} data-testid="deal-paper-download">{dl.busy ? 'Downloading…' : PAPER_WORDS.download}</button>
        )}
      </div>
      {dl.err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="deal-paper-refusal">{dl.err}</p>}
      {row.action === 'sign' && <p className={`m-0 ${SUB}`}>{PAPER_WAIT_DOWNLOAD}</p>}
      {row.action === 'closed' && <p className={`m-0 ${SUB}`}>{PAPER_CLOSED_LINE}</p>}
      {signing?.state === 'loading' && <p className={`m-0 ${SUB}`} aria-live="polite">Reading how to sign…</p>}
      {signing?.state === 'unreadable' && <Unreadable what="How to sign this envelope" claim="That is not a claim that nothing is waiting on you." onRetry={loadDetail} />}
      {signing?.line && <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="deal-paper-sign">{signing.line}</p>}
      {signing?.state === 'yours' && (
        <div className="flex flex-col gap-1">
          <button type="button" className={`${LINK} min-h-[44px] w-fit text-left sm:min-h-0`} disabled={again.busy} onClick={resend} data-testid="deal-paper-resend">{again.busy ? PAPER_WORDS.resending : PAPER_WORDS.resend}</button>
          {again.sent && <p role="status" className={`m-0 ${SUB}`} data-testid="deal-paper-resent">{PAPER_WORDS.resent}</p>}
          {again.err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="deal-paper-resend-refused">{again.err}</p>}
        </div>
      )}
    </div>
  );
}
