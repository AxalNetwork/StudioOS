/**
 * D1233 (#3241) — the document viewer (KYC4, KYC4b, KYC15d): inside the page,
 * never a new tab. The bytes come through `kycPeopleApi.documentBlob`, which
 * sends `request()`'s headers; the Worker logs every view
 * (`kyc_document_access`). Watermarked with who is looking and when, and no
 * download is offered: no link, no save control, no context menu on the image.
 * Full screen on a phone (the Lightbox's own rule).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { kycPeopleApi } from '../../../lib/api/kycPeople.js';
import { reportError } from '../../../lib/log';
import { actionGhost } from '../../../ui';
import { timeLabel } from './peopleModel';
import Sheet from '../../../ui/Sheet.jsx';

const FOOT = 'This view is recorded. Download is not offered.';

/** What the viewer says when it cannot show the document (KYC4b). */
export function viewerRefusal(e, { rejectedOn = null } = {}) {
  if (e?.code === 'access_required') {
    return { key: 'access', title: 'Your HQ staff sign-in is needed', line: 'The document needs your HQ staff sign-in. Sign in through your company access page, then try again.', retry: true };
  }
  if (e?.status === 404 && rejectedOn) {
    return { key: 'deleted', title: 'This document was deleted', line: `This document was deleted when the check was rejected on ${rejectedOn}. The decision stays on record.`, retry: false };
  }
  if (e?.status === 404) return { key: 'missing', title: 'This document is not on file', line: 'The Worker found no stored file for it. Nothing was shown.', retry: false };
  if (e?.status === 415) return { key: 'type', title: 'This file cannot be shown', line: 'Its stored type is not one the viewer opens. Nothing was shown.', retry: false };
  return { key: 'unreadable', title: 'The document could not be read', line: 'Nothing was shown. Try again.', retry: true };
}

function Watermark({ text }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-around overflow-hidden" data-testid="kyc-viewer-watermark">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="-rotate-12 select-none whitespace-nowrap text-center text-[13px] font-bold text-violet-700/25 dark:text-violet-300/25">{text}</span>
      ))}
    </div>
  );
}

/**
 * `doc` is one row of `peopleModel.documentRows`; `viewer` names who is
 * looking. A removed document never reads: it says when it went.
 */
export default function KycViewer({ userId, doc, viewer, rejectedOn = null, onClose, nowIso, fetchDoc = null }) {
  const [state, setState] = useState(doc.removed ? { kind: 'refused', why: viewerRefusal({ status: 404 }, { rejectedOn: doc.removed }) } : { kind: 'loading' });
  const [rotate, setRotate] = useState(0);
  const [fit, setFit] = useState(true);
  const url = useRef(null);
  const at = useRef(timeLabel(nowIso || new Date().toISOString()));

  const load = useCallback(async () => {
    if (doc.removed) return;
    setState({ kind: 'loading' });
    try {
      // D1234: a business's document passes its own loader (`kycPeople.businessDocumentBlob`).
      const { blob, type } = fetchDoc ? await fetchDoc() : await kycPeopleApi.documentBlob(userId, doc.legacy ? null : doc.id);
      if (url.current && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url.current);
      url.current = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null;
      setState({ kind: 'ok', type, src: url.current });
    } catch (e) {
      reportError('KycViewer:document', e);
      setState({ kind: 'refused', why: viewerRefusal(e, { rejectedOn }) });
    }
  }, [userId, doc, rejectedOn, fetchDoc]);
  useEffect(() => {
    load();
    return () => { if (url.current && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url.current); };
  }, [load]);

  const mark = `Viewed by ${viewer || 'you'} · ${at.current}`;
  const tools = state.kind === 'ok' && (
    <div className="flex items-center gap-2">
      <button type="button" className={actionGhost} onClick={() => setRotate((r) => (r + 90) % 360)} data-testid="kyc-viewer-rotate">Rotate</button>
      <button type="button" className={actionGhost} onClick={() => setFit((f) => !f)} data-testid="kyc-viewer-fit">{fit ? '100%' : 'Fit'}</button>
    </div>
  );
  return (
    <Sheet label={`${doc.title}`} title={doc.title} onClose={onClose} width={960} testId="kyc-viewer"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="kyc-viewer-foot">{FOOT}</span>
          <div className="flex items-center gap-2">{tools}<button type="button" className={actionGhost} onClick={onClose}>Close</button></div>
        </div>
      )}>
      {state.kind === 'loading' && <p className="m-0 py-16 text-center text-[13px] text-axal-muted dark:text-gray-400">Reading the document…</p>}
      {state.kind === 'refused' && (
        <div className="flex flex-col items-center gap-2 py-14 text-center" data-testid={`kyc-viewer-refused-${state.why.key}`}>
          <p className="m-0 text-[15px] font-bold">{state.why.title}</p>
          <p className="m-0 max-w-[440px] text-[13px] text-axal-muted dark:text-gray-400">{state.why.line}</p>
          {state.why.retry && <button type="button" className={actionGhost} onClick={load} data-testid="kyc-viewer-retry">Try again</button>}
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="relative flex min-h-[420px] items-center justify-center overflow-auto rounded-lg bg-gray-100 dark:bg-gray-950" onContextMenu={(e) => e.preventDefault()} data-testid="kyc-viewer-page">
          {/^application\/pdf/.test(state.type)
            ? <iframe title={doc.title} src={state.src ? `${state.src}#toolbar=0&navpanes=0` : undefined} className="h-[70vh] w-full border-0" style={{ transform: `rotate(${rotate}deg)` }} />
            : <img src={state.src || undefined} alt={doc.title} draggable={false} className={fit ? 'max-h-[70vh] max-w-full select-none' : 'select-none'} style={{ transform: `rotate(${rotate}deg)` }} />}
          <Watermark text={mark} />
        </div>
      )}
    </Sheet>
  );
}
