/**
 * D789 (#2214): one model colour across Usage, Cost and HQ AI usage.
 * The seven canvas models keep their canvas colours. Other IDs hash into the
 * same categorical palette, independently of order, range or active filters.
 * Labels always accompany colour; colour alone never identifies a series.
 */
export const MODEL_COLOURS = Object.freeze({
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': '#7c3aed',
  '@cf/zai-org/glm-4.7-flash': '#a78bfa',
  '@cf/google/gemma-4-26b-a4b-it': '#0f766e',
  '@cf/moonshotai/kimi-k2.6': '#d97706',
  '@cf/openai/whisper-large-v3-turbo': '#475569',
  '@cf/black-forest-labs/flux-1-schnell': '#db2777',
  '@cf/meta/llama-guard-3-8b': '#c4b5fd',
});
export const MODEL_PALETTE = Object.freeze(Object.values(MODEL_COLOURS));
export function modelColour(id) {
  const key = String(id ?? '');
  if (Object.hasOwn(MODEL_COLOURS, key)) return MODEL_COLOURS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  return MODEL_PALETTE[hash % MODEL_PALETTE.length];
}
