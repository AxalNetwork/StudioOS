// Pitch Deck Builder — one slide card in the grid.
//
// Design reference: spin-out-lab-pipeline/project/Pitch Deck Builder.dc.html
// SLIDE GRID (L108-125): 16:9 thumbnail, violet numbered badge top-left, green
// check top-right when the slide is fully populated, hover lift + violet
// border, and a footer row of title / status text / status dot.
//
// The thumbnail renders the REAL `axal_spinout_demoday` React slide through the
// shared <Thumbnail> clip window — the design's <dc-import name="AxalSlide">
// equivalent in this stack.

import { Check, Loader2 } from 'lucide-react';

export default function PitchDeckSlideCard({ slide, template, fields, Thumbnail, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-[0_12px_28px_-14px_rgba(107,70,193,.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      data-testid={`slide-card-${slide.spec}`}
    >
      <div className="relative aspect-video bg-[#F1F0F5] dark:bg-gray-800 border-b border-gray-100 dark:border-gray-800 overflow-hidden">
        {Thumbnail
          ? <Thumbnail template={template} data={fields || undefined} slideIndex={slide.index} />
          : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}

        {/* number badge (design L115) */}
        <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-[7px] bg-violet-600 text-white text-[12px] font-extrabold flex items-center justify-center shadow-md">
          {slide.n}
        </span>

        {/* completion check (design L116) */}
        {slide.complete && (
          <span
            className="absolute top-2.5 right-2.5 w-[22px] h-[22px] rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md"
            data-testid={`slide-complete-${slide.spec}`}
          >
            <Check size={12} strokeWidth={3} />
          </span>
        )}

        {/* hover scrim (design .pd-ov L117) */}
        <span className="absolute inset-0 bg-gray-900/25 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none" />
      </div>

      <div className="px-3.5 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 truncate">{slide.title}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{slide.statusText}</div>
        </div>
        <span
          className={`w-[9px] h-[9px] flex-none rounded-full ${slide.dotClass}`}
          title={slide.statusText}
        />
      </div>
    </button>
  );
}
