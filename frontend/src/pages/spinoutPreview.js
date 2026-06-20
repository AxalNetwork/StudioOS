// Task #26/#27 — pure helpers for the Spin-Out deck builder's single live
// preview. Kept in their own module (not inlined in PitchDeckPage) so the
// preview-follows-the-selected-slide wiring — the per-slide header label, the
// slide-2 pain-frequency nudge, and the real-vs-placeholder pains detection —
// can be unit-tested without mounting the whole heavy editor page.
// See frontend/test/spinout_preview_sync.test.mjs.

// `problem.pains_json` is a JSON array of [label, pct, count] rows. The mapper
// falls back to neutral placeholders (count === '—', the em-dash DASH sentinel
// shared by the Worker + dev FastAPI mappers) whenever the founder has no
// grouped discovery pains yet. Detect that all-placeholder state so the
// slide-2 caption can nudge the founder instead of implying the slide is
// "done". Returns true only when there's real grouped data to show.
export function spinoutHasRealPains(fields) {
  const raw = fields?.['problem.pains_json'];
  if (!raw) return false;
  let rows;
  try { rows = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(rows) || rows.length === 0) return false;
  // Real rows carry a numeric "n" or "n / total" count; placeholders use '—'.
  return rows.some((r) => Array.isArray(r) && r[2] != null && String(r[2]).trim() !== '—');
}

// The single live preview tracks whichever slide is selected in the SLIDES
// list (slideIndex = activeIdx). The label + caption adapt per slide: the
// cover keeps its validation-signal copy, slide 2 keeps the pain-frequency
// copy + empty-data nudge, and every other slide gets a neutral live-preview
// caption keyed off the slide title.
export function spinoutPreviewMeta({ activeIdx, activeSlide, fields }) {
  if (activeIdx === 0) {
    return {
      label: 'Cover preview — live validation signal',
      caption: 'Cumulative discovery interviews logged across your 30-day sprint — updates as you log more. Empty until your first interview.',
    };
  }
  if (activeIdx === 1) {
    const hasReal = spinoutHasRealPains(fields);
    return {
      label: 'Slide 2 preview — pain frequency',
      caption: hasReal
        ? 'Your top grouped discovery pains, ranked by how many interviews mention each — updates as you log and group pains.'
        : 'Placeholder pains shown. Log discovery interviews and group their pains in Customer Discovery to populate this slide with real data.',
    };
  }
  return {
    label: `Slide ${activeIdx + 1} preview — ${activeSlide?.title || 'Untitled'}`,
    caption: 'Live preview of this slide — updates as you edit your project data.',
  };
}
