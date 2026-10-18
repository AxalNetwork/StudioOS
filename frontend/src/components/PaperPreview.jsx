import React, { useEffect, useRef, useState } from 'react';
import { contractsApi } from '../lib/api/contracts.js';

// D711 (#1776) — the live preview draws the Worker's paper, not its own: one
// HTML document from POST /admin/contracts/templates/render, the same paper
// the PDF, the envelope preview, the signer's page and a signed copy print.
// The faces come once per `paper_sha256` from /templates/paper-fonts and fill
// the paper's empty `<style id="paper-fonts">`.

const FONTS_SLOT = '<style id="paper-fonts"></style>';

/** The paper with its faces in place. CSS holding a `<` is never spliced in. */
export function withPaperFonts(html, css) {
  if (!html || !css || css.includes('<')) return html || '';
  return html.replace(FONTS_SLOT, `<style id="paper-fonts">${css}</style>`);
}

/**
 * The paper in a frame that runs no script: the sandbox is `allow-same-origin`
 * only, so the parent can read the frame's height, and the paper's own CSP
 * forbids scripts too. `onFrameLoad(iframe)` lets the template editor read the
 * paper's headings from outside (D717 #1852); nothing runs inside the frame.
 */
export function PaperFrame({ html, title, onFrameLoad }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(1056);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight;
    if (h) setHeight(h);
    if (onFrameLoad && ref.current) onFrameLoad(ref.current);
  };
  return (
    <iframe
      ref={ref}
      sandbox="allow-same-origin"
      srcDoc={html}
      title={title}
      onLoad={fit}
      style={{ height }}
      className="w-full border-0"
    />
  );
}

/**
 * The live preview of a template on the paper. Redraws 500 ms after the last
 * edit, keeps the last good paper while it updates, and says when a draw fails.
 */
export default function PaperPreview({
  title,
  body,
  resolveTokens = true,
  version = null,
  docType = '',
  category = null,
  pageSize = 'letter',
  cover = 'dark',
  // D717 (#1852): the editor's unsaved pair (`null` is "from the slug"). An
  // absent prop sends no key, so the legacy modal's request is unchanged.
  docKind,
  axalParty,
  onDrawn,
  onFrameLoad,
}) {
  const [paper, setPaper] = useState(null);
  const drawnRef = useRef(onDrawn);
  drawnRef.current = onDrawn;
  const [fonts, setFonts] = useState({ sha: null, css: '' });
  const [drawing, setDrawing] = useState(false);
  const [failed, setFailed] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    const ask = ++latest.current;
    const timer = setTimeout(async () => {
      setDrawing(true);
      try {
        const drawn = await contractsApi.renderPaper({
          title: title || '', body: body || '', slug: docType || '', category,
          version: Number.isInteger(version) ? version : null,
          resolve: resolveTokens ? 'brackets' : 'raw', page_size: pageSize, cover, fonts: 'omit',
          ...(docKind !== undefined ? { doc_kind: docKind } : {}),
          ...(axalParty !== undefined ? { axal_party: axalParty } : {}),
        });
        if (ask !== latest.current) return;
        setPaper(drawn);
        drawnRef.current?.(drawn);
        setFailed('');
        if (drawn.paper_sha256 && drawn.paper_sha256 !== fonts.sha) {
          const faces = await contractsApi.paperFonts();
          if (ask === latest.current) setFonts({ sha: faces.paper_sha256, css: faces.css || '' });
        }
      } catch (e) {
        if (ask === latest.current) setFailed(e?.message || 'The preview could not be drawn.');
      } finally {
        if (ask === latest.current) setDrawing(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // `fonts.sha` is read, not watched: a new face set never redraws the paper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, resolveTokens, version, docType, category, pageSize, cover, docKind, axalParty]);

  return (
    <div className="py-4 px-3" data-testid="paper-preview">
      {(drawing || failed) && (
        <div className={`mb-2 text-[11px] ${failed ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400'}`} role="status">
          {failed ? `${failed} ${paper ? 'Showing the last paper that drew.' : ''}`.trim() : 'Drawing…'}
        </div>
      )}
      {paper?.html
        ? <PaperFrame html={withPaperFonts(paper.html, fonts.css)} title={`${title || 'Document'} — preview`} onFrameLoad={onFrameLoad} />
        : !failed && <div className="text-xs text-gray-400">Drawing the paper…</div>}
    </div>
  );
}
