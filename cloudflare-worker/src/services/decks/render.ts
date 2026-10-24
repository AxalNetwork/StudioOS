/**
 * The slide shapes the export writers share (`pptx.ts`, and the deck route's
 * renderable deck).
 *
 * Task #16's `renderDeckHTML` lived here: one Tailwind-styled document loading
 * Tailwind from a CDN, which nothing called. D901 (#2680) removed it; the HTML
 * export is `offlineHtml.ts`, one self-contained file that asks for nothing.
 */
export type RenderableField = {
  key: string;
  label: string;
  kind: 'title' | 'subtitle' | 'paragraph' | 'bullets' | 'image' | 'metric_grid' | 'quote';
  value: any;
  source?: 'data' | 'ai' | 'placeholder';
};

export type RenderableSlide = {
  spec_id?: string;
  title: string;
  subtitle?: string | null;
  appendix?: boolean;
  fields: RenderableField[];
};

export type RenderableDeck = {
  title: string;
  method_label?: string;
  project_name?: string;
  slides: RenderableSlide[];
};
