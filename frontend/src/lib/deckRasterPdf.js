// Task #11 — Direct PDF download for advanced deck templates.
//
// Rasterises each `[data-slide-frame]` in the live DOM at native
// 1920×1080 via html2canvas (2× DPI for crispness), then assembles
// the canvases into a single landscape jsPDF document sized in the
// same 1920×1080 unit space so each slide takes exactly one page
// with zero margins / headers / footers.
//
// The advanced templates render inside a `transform: scale()` wrapper
// (`.deck-print-inner`) so they fit the viewer width. html2canvas
// honours that transform and would otherwise capture a tiny rendition.
// We use the `onclone` hook to neutralise the transform on the cloned
// document only — the original DOM is untouched — so we always
// capture at native 1920×1080 regardless of viewport size or
// fullscreen state.

const SLIDE_W = 1920;
const SLIDE_H = 1080;

function slugify(s) {
  return String(s || 'pitch-deck')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'pitch-deck';
}

export async function downloadRasterDeckPdf(deck, { stageEl, onProgress } = {}) {
  if (!stageEl) throw new Error('stageEl required');
  const frames = Array.from(stageEl.querySelectorAll('[data-slide-frame]'));
  if (frames.length === 0) throw new Error('No slides found to export.');

  // Lazy-load the heavy libs only on first export so the viewer's
  // initial paint stays light.
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  // Match the slide native dimensions so jsPDF's drawing units are
  // px and one slide == one page. Landscape because 1920 > 1080.
  const pdf = new JsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [SLIDE_W, SLIDE_H],
    compress: true,
    hotfixes: ['px_scaling'],
  });

  for (let i = 0; i < frames.length; i++) {
    onProgress?.({ current: i + 1, total: frames.length });
    const el = frames[i];
    // 2× DPI yields ~3840×2160 raster — sharp on retina without
    // blowing the PDF up beyond ~5-10 MB for a typical 12-slide deck.
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(el, {
      width: SLIDE_W,
      height: SLIDE_H,
      windowWidth: SLIDE_W,
      windowHeight: SLIDE_H,
      scale: 2,
      backgroundColor: '#FFFFFF',
      useCORS: true,
      allowTaint: false,
      logging: false,
      // Neutralise the viewer's scale-to-fit transform on the clone
      // so html2canvas captures the slide at its native pixel size.
      // We also set per-slide overflow to visible so any decorative
      // elements that bleed slightly past 1920×1080 still capture.
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll('.deck-print-inner').forEach((n) => {
          n.style.transform = 'none';
          n.style.width = `${SLIDE_W}px`;
        });
        clonedDoc.querySelectorAll('.deck-print-scaler').forEach((n) => {
          n.style.width = `${SLIDE_W}px`;
          n.style.transform = 'none';
        });
        clonedDoc.querySelectorAll('.deck-print-stage').forEach((n) => {
          n.style.padding = '0';
          n.style.width = `${SLIDE_W}px`;
          n.style.background = '#FFFFFF';
        });
        clonedDoc.querySelectorAll('.deck-print-frames').forEach((n) => {
          n.style.gap = '0';
        });
        // The fullscreen single-slide viewer hides off-screen slides
        // with overflow:hidden + translateY. Reset both so every
        // slide is visible to the cloned-doc capture.
        clonedDoc.querySelectorAll('[data-fullscreen-viewport]').forEach((n) => {
          n.style.overflow = 'visible';
          n.style.transform = 'none';
        });
        clonedDoc.querySelectorAll('[data-fullscreen-track]').forEach((n) => {
          n.style.transform = 'none';
          n.style.transition = 'none';
        });
      },
    });
    // JPEG @ 0.92 — visually indistinguishable from PNG on slide-grade
    // content (text + SVG + flat colour) and ~6× smaller on disk.
    const img = canvas.toDataURL('image/jpeg', 0.92);
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], 'landscape');
    pdf.addImage(img, 'JPEG', 0, 0, SLIDE_W, SLIDE_H, undefined, 'FAST');
  }

  const fname = `${slugify(deck?.title || 'pitch-deck')}-v${deck?.version || 1}.pdf`;
  pdf.save(fname);
  onProgress?.({ current: frames.length, total: frames.length, done: true });
}
