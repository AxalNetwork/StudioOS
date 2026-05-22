import React from 'react';
import type { TemplateMeta } from './templates';
import { SAMPLE_PREVIEW_DATA } from './sample';

const OUTER_W = 320;
const OUTER_H = 180;
const INNER_W = 1920;
const INNER_H = 1080;
const SCALE = OUTER_W / INNER_W;

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
            width: OUTER_W,
            height: OUTER_H,
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
  return (
    <ThumbnailBoundary templateKey={template.key}>
      <div
        aria-hidden="true"
        style={{
          width: OUTER_W,
          height: OUTER_H,
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
            transform: `scale(${SCALE})`,
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
