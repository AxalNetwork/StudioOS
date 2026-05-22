import React, { useEffect, useRef, useState } from 'react';
import type { TemplateMeta } from './templates';
import { SAMPLE_PREVIEW_DATA } from './sample';

const INNER_W = 1920;
const INNER_H = 1080;

interface ThumbnailProps {
  template: TemplateMeta;
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

export const Thumbnail: React.FC<ThumbnailProps> = ({ template }) => {
  const Comp = template.Component;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Sensible default so first paint isn't a microscopic dot before the
  // ResizeObserver fires.
  const [scale, setScale] = useState(0.18);

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
        }}
      >
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
          <Comp data={SAMPLE_PREVIEW_DATA} editable={false} />
        </div>
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
  slideCount: number;
  currentIndex: number;
  onIndexChange: (i: number) => void;
  /** Receives the scroller element so the modal can drive prev/next. */
  registerScroller?: (el: HTMLDivElement | null) => void;
}

export const PreviewStage: React.FC<PreviewStageProps> = ({
  template,
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
              <Comp data={SAMPLE_PREVIEW_DATA} editable={false} />
            </div>
          </div>
        </div>
      </div>
    </ThumbnailBoundary>
  );
};
