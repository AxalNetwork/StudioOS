// Live editor preview — the SAME renderer the library card and preview modal use.
//
// Both editors (/spinout-lab/brand inline, /build/brand full) mount this and feed
// it their current UNSAVED state, so what the founder sees while typing is the
// real template design, not a stand-in. Desktop scales the 720px artboard to the
// pane width; Mobile puts the same artboard in a narrow device frame — the
// selected template never changes between the two.
//
// The generic fallback below is reachable ONLY for the five built-in visual
// styles (minimal / bold-hero / video-first / editorial / product-mock), which
// have no source design; every supplied template resolves in the registry and
// renders its own design (guarded by brand_template_previews.test.mjs).
import BrandTemplatePreview from './templates/BrandTemplatePreview.jsx';
import { getPreviewComponent } from './templates/templateRegistry.js';

const MOBILE_WIDTH = 390;

export default function TemplateEditorPreview({
  templateKey,
  data = {},
  device = 'desktop',
  maxHeight = 720,
  className = '',
}) {
  const hasReal = !!getPreviewComponent(templateKey);
  const mobile = device === 'mobile';

  return (
    <div
      className={`w-full overflow-y-auto overflow-x-hidden flex justify-center ${className}`}
      style={{ maxHeight }}
      data-testid="editor-preview-surface"
      data-preview-device={device}
      data-preview-template={templateKey || ''}
    >
      {/* dark-mode-exempt: the artboard IS the light public landing page,
          not app chrome — painting it dark would misrepresent the output. */}
      <div
        className="flex-none bg-white rounded-xl shadow-xl overflow-hidden"
        style={{ width: mobile ? MOBILE_WIDTH : '100%', maxWidth: '100%' }}
      >
        {hasReal ? (
          <BrandTemplatePreview templateKey={templateKey} data={data} full />
        ) : (
          <GenericArtboard data={data} mobile={mobile} />
        )}
      </div>
    </div>
  );
}

/** Built-in generic visual styles have no source design to port — this is the
 *  hero-and-form shape the worker's renderMinimal family actually produces.
 *  dark-mode-exempt: it IS the light public page, not app chrome. */
function GenericArtboard({ data, mobile }) {
  const accent = data.themeColor || '#7c3aed';
  return (
    <div className={mobile ? 'px-5 py-6' : 'px-10 py-9'} style={{ fontFamily: data.fontStack || undefined }}>
      <div className="h-2 w-16 rounded-full mb-5" style={{ background: accent }} />
      <div className={`font-extrabold text-gray-900 leading-tight mb-3 ${mobile ? 'text-[22px]' : 'text-[30px]'}`}>
        {data.headline || data.name || 'Your headline'}
      </div>
      {data.subheadline && (
        <div className={`text-gray-500 mb-4 ${mobile ? 'text-[13.5px]' : 'text-[15px]'}`}>{data.subheadline}</div>
      )}
      {data.body && (
        <div className="text-[13px] text-gray-600 leading-relaxed mb-6 whitespace-pre-line">{data.body}</div>
      )}
      <div className={`border-t border-gray-100 pt-5 gap-2 ${mobile ? 'flex flex-col' : 'flex flex-wrap items-center'}`}>
        {/* dark-mode-exempt: form mock inside the light artboard above. */}
        {(data.formFields || ['Email']).map((f) => (
          <div key={f} className="h-10 flex-1 min-w-[110px] rounded-lg border border-gray-200 bg-gray-50 px-3 flex items-center text-[12px] text-gray-400">{f}</div>
        ))}
        <div
          className="h-10 px-4 rounded-lg flex-none flex items-center justify-center text-[12.5px] font-bold text-white whitespace-nowrap"
          style={{ background: accent }}
        >
          {data.ctaText || 'Join the waitlist'}
        </div>
      </div>
    </div>
  );
}
