// Shared scaler for the real template previews.
//
// Every preview component renders a fixed 720px-wide artboard of its source
// design (see templateRegistry.js). This wrapper measures its own container
// and CSS-scales that artboard to fit, so the same faithful render serves
// three surfaces: the library grid card, the compact list row, and the
// preview modal. Scaling a fixed-width artboard — rather than making each
// design responsive — is what lets each preview keep its source's real
// typographic hierarchy at any card size.
import { useLayoutEffect, useRef, useState } from 'react';
import { getPreviewComponent, PREVIEW_NATURAL_WIDTH } from './templateRegistry.js';

/**
 * @param {object} props
 * @param {string} props.templateKey  production template key (e.g. "capital-ready-kit")
 * @param {object} [props.data]       brand/content overrides passed through to the preview
 * @param {number} [props.height]     clipped viewport height in px (card modes)
 * @param {boolean} [props.full]      modal mode: scale to container width but show the
 *                                    whole artboard height (caller provides the scroll)
 * @param {string} [props.className]  extra classes on the outer viewport
 */
export default function BrandTemplatePreview({ templateKey, data, height = 128, full = false, className = '' }) {
  const Preview = getPreviewComponent(templateKey);
  const viewportRef = useRef(null);
  const artboardRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [artHeight, setArtHeight] = useState(0);

  useLayoutEffect(() => {
    if (!Preview) return undefined;
    const measure = () => {
      const w = viewportRef.current?.clientWidth || 0;
      if (w > 0) setScale(w / PREVIEW_NATURAL_WIDTH);
      const h = artboardRef.current?.offsetHeight || 0;
      if (h > 0) setArtHeight(h);
    };
    measure();
    // Track container resizes (grid/list toggle, sidebar collapse, window).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && viewportRef.current) ro.observe(viewportRef.current);
    return () => ro?.disconnect();
  }, [Preview, templateKey]);

  if (!Preview) return null;

  const viewportHeight = full ? (scale > 0 && artHeight > 0 ? artHeight * scale : undefined) : height;
  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden ${className}`}
      style={{ height: viewportHeight }}
      data-testid={`brand-template-preview-${templateKey}`}
      aria-hidden="true"
    >
      <div
        ref={artboardRef}
        style={{
          width: PREVIEW_NATURAL_WIDTH,
          transform: `scale(${scale || 0.001})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <Preview data={data} />
      </div>
    </div>
  );
}
