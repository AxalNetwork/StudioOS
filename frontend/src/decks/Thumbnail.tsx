import React, { useEffect, useRef, useState } from 'react';
import type { TemplateMeta } from './templates';
import type { DeckData } from './DeckBase';
import { previewDataFor } from './sample';

const INNER_W = 1920;
const INNER_H = 1080;

interface ThumbnailProps {
  template: TemplateMeta;
  /**
   * Optional live data override. When provided it is passed straight to the
   * template Component (which hydrate()s flat dotted-key field maps), so the
   * picker card can render a project's REAL data instead of the bundled
   * SAMPLE. Falls back to the sample preview when omitted/null.
   */
  data?: DeckData | null;
}

interface BoundaryState {
  failed: boolean;
}

class ThumbnailBoundary extends React.Component<
  React.PropsWithChildren<{ templateKey: string }>,
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
     
    console.error(`[Thumbnail] Failed to render ${this.props.templateKey}:`, error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="img"
          aria-label={`Failed to render template ${this.props.templateKey}`}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#FEF2F2',
            color: '#B91C1C',
            border: '1px dashed #FCA5A5',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'Inter, system-ui, sans-serif',
            textAlign: 'center',
            padding: 12,
          }}
        >
          Failed to render {this.props.templateKey}
        </div>
      );
    }
    return this.props.children;
  }
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ template, data }) => {
  const Comp = template.Component;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Sensible default so first paint isn't a microscopic dot before the
  // ResizeObserver fires.
  const [scale, setScale] = useState(0.18);
  // Lazy-mount the heavy template Component only once the card has come
  // close to the viewport. Several templates (sequoia_classic, yc_seed,
  // kawasaki_10_20_30) render hundreds of nodes / SVGs / charts each;
  // mounting all 12 up-front is the dominant cost on picker open.
  // Once mounted we keep the Comp around so scrolling back doesn't
  // thrash. `IntersectionObserver` is available in every browser we
  // support — guard for SSR / tests where it might be absent.
  const [mounted, setMounted] = useState(
    typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / INNER_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (mounted) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setMounted(true);
            io.disconnect();
            break;
          }
        }
      },
      // Mount slightly before the card scrolls in so the user rarely
      // sees the placeholder.
      { rootMargin: '200px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  return (
    <ThumbnailBoundary templateKey={template.key}>
      <div
        ref={wrapRef}
        aria-hidden="true"
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          overflow: 'hidden',
          borderRadius: 6,
          border: '1px solid rgba(148, 163, 184, 0.35)',
          background: '#FFFFFF',
          pointerEvents: 'none',
          position: 'relative',
          // Let the browser skip painting/layout for off-screen cards
          // entirely. The intrinsic size keeps the scroll height stable
          // so the grid doesn't jump while cards are rendered-on-demand.
          contentVisibility: 'auto',
          containIntrinsicSize: '180px 320px',
        } as React.CSSProperties}
      >
        {mounted && (
          <div
            style={{
              width: INNER_W,
              height: INNER_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <Comp data={data ?? previewDataFor(template.key)} editable={false} />
          </div>
        )}
      </div>
    </ThumbnailBoundary>
  );
};

// =====================================================================
// Large preview surface for the TemplatePreviewModal. Renders the full
// template (all N Slide16x9 children stacked) inside a width-fitted
// scaled viewport. Programmatic prev/next scroll by slide height; scroll
// position is rounded to derive the current slide for the counter.
// =====================================================================
interface PreviewStageProps {
  template: TemplateMeta;
  /** Optional live data override — see Thumbnail. Falls back to the sample. */
  data?: DeckData | null;
  slideCount: number;
  currentIndex: number;
  onIndexChange: (i: number) => void;
  /** Receives the scroller element so the modal can drive prev/next. */
  registerScroller?: (el: HTMLDivElement | null) => void;
}

export const PreviewStage: React.FC<PreviewStageProps> = ({
  template,
  data,
  slideCount,
  currentIndex,
  onIndexChange,
  registerScroller,
}) => {
  const Comp = template.Component;
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / INNER_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    registerScroller?.(scrollRef.current);
    return () => registerScroller?.(null);
  }, [registerScroller]);

  const slideH = INNER_H * scale;

  // Round scroll position to the nearest slide for the counter.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || slideH <= 0) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const idx = Math.round(scroller.scrollTop / slideH);
        const clamped = Math.max(0, Math.min(slideCount - 1, idx));
        if (clamped !== currentIndex) onIndexChange(clamped);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [slideH, slideCount, currentIndex, onIndexChange]);

  return (
    <ThumbnailBoundary templateKey={template.key}>
      <div ref={outerRef} style={{ width: '100%', height: '100%' }}>
        <div
          ref={scrollRef}
          style={{
            width: '100%',
            height: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#0F172A',
            borderRadius: 6,
          }}
        >
          {/* Layout-sized wrapper so the scroll track matches the scaled
              content height. Transform doesn't affect layout, so without
              this the scroll surface would be 1080*N px tall. */}
          <div
            style={{
              width: INNER_W * scale,
              height: slideH * slideCount,
              margin: '0 auto',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: INNER_W,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            >
              <Comp data={data ?? previewDataFor(template.key)} editable={false} />
            </div>
          </div>
        </div>
      </div>
    </ThumbnailBoundary>
  );
};
