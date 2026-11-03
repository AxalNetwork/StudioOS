/**
 * D1578 (#3825, deck v2 E5) — an AI-drawn image stays marked in every export
 * (owner decision V = A: IPTC's DigitalSourceType and the model id, in XMP).
 *
 *   · `aiImagesOf`  which of a deck's images were drawn by a model, and by
 *                   which one: the venture's `deck_images` rows with
 *                   `source = 'generated'`, by each image block's and each
 *                   card background's `image_id`. Read in its own guarded
 *                   query: a store it cannot read marks nothing new, and the
 *                   files keep whatever XMP they were stored with.
 *   · `markImages`  the bytes an export embeds (PowerPoint, .odp, HTML): an
 *                   AI image whose file carries no DigitalSourceType gets the
 *                   packet written in (`withXmp`, D1505's writer). An image
 *                   stored since D1505 already carries it and is left as it
 *                   is. Uploads are never marked.
 *   · `pdfXmp`      the PDF's document XMP. The browser re-encodes pictures
 *                   into the PDF, so a file's own XMP does not survive there:
 *                   the document says it holds AI-made pictures
 *                   (`compositeWithTrainedAlgorithmicMedia`) and lists each
 *                   one's model and card. It also carries the PDF/UA
 *                   identifier, the title and the language.
 *
 * No prompt, name or figure is written: only the IPTC term, the model id and
 * a card number.
 */
import type { Env } from '../../types';
import { AI_SOURCE_TYPE, aiXmpPacket, withXmp, xmpOf, type ImageMime } from './imageBytes';

/** IPTC's term for a work that holds trained-model media among other content. */
export const AI_COMPOSITE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
/** When a drawn image's row names no model. */
export const UNKNOWN_MODEL = 'unrecorded';

export type AiImage = { url: string; model: string; card: number };

const IMAGE_UID = /^[0-9a-f-]{36}$/;

/** The image ids a deck's cards name, each with its URL and its card (blocks and backgrounds). */
export function imageRefsOf(slides: any[]): { uid: string; url: string; card: number }[] {
  const out: { uid: string; url: string; card: number }[] = [];
  (Array.isArray(slides) ? slides : []).forEach((s, card) => {
    const bg = s?.background;
    if (bg && typeof bg.image_id === 'string' && IMAGE_UID.test(bg.image_id) && typeof bg.image_url === 'string') out.push({ uid: bg.image_id, url: bg.image_url, card });
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
      if (b?.kind === 'image' && typeof b.image_id === 'string' && IMAGE_UID.test(b.image_id) && typeof b.image_url === 'string') out.push({ uid: b.image_id, url: b.image_url, card });
    }
  });
  return out;
}

/** The deck's AI-drawn images, by the venture's own rows. Empty when none, or when the store cannot be read. */
export async function aiImagesOf(env: Env, projectId: number, slides: any[]): Promise<AiImage[]> {
  const refs = imageRefsOf(slides);
  if (!refs.length) return [];
  const uids = [...new Set(refs.map((r) => r.uid))].slice(0, 200);
  try {
    const rows = (await env.DB.prepare(
      // The ids go in as one bound JSON array: nothing is written into the query text.
      "SELECT uid, model FROM deck_images WHERE project_id = ? AND source = 'generated' AND uid IN (SELECT value FROM json_each(?))",
    ).bind(projectId, JSON.stringify(uids)).all<{ uid: string; model: string | null }>()).results ?? [];
    const model = new Map(rows.map((r) => [r.uid, (r.model && String(r.model).trim()) || UNKNOWN_MODEL]));
    return refs.filter((r) => model.has(r.uid)).map((r) => ({ url: r.url, model: model.get(r.uid)!, card: r.card }));
  } catch {
    console.warn('[decks/marking] provenance unreadable', { outcome: 'unmarked' });
    return [];
  }
}

const MIME = { png: 'image/png', jpeg: 'image/jpeg' } as const;

/** Whether a file already says it was made by a trained model. */
export const isMarked = (bytes: Uint8Array): boolean => (xmpOf(bytes) ?? '').includes(AI_SOURCE_TYPE);

/**
 * The fetched images with each AI image marked, in place. Returns how many
 * files gained the packet. A kind the writer cannot walk (GIF) is left as it
 * is; its PDF and the export's own record still name it.
 */
export function markImages(images: Map<string, { kind: string; bytes: Uint8Array } | null>, ai: AiImage[]): number {
  let marked = 0;
  for (const a of ai) {
    const img = images.get(a.url);
    if (!img || isMarked(img.bytes)) continue;
    const mime = (MIME as Record<string, ImageMime>)[img.kind];
    const out = mime ? withXmp(img.bytes, mime, aiXmpPacket(a.model)) : null;
    if (!out) continue;
    images.set(a.url, { ...img, bytes: out });
    marked += 1;
  }
  return marked;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string));

/**
 * The PDF's document XMP: PDF/UA-1's identifier, the title and language, and
 * — when the deck holds AI-drawn pictures — the composite term and one entry
 * per picture with its model and card.
 */
export function pdfXmp({ title, lang, ai }: { title: string; lang: string; ai: AiImage[] }): string {
  const aiPart = ai.length
    ? ` Iptc4xmpExt:DigitalSourceType="${AI_COMPOSITE_TYPE}"><axal:aiImages><rdf:Bag>${ai.map((a) => (
      `<rdf:li rdf:parseType="Resource"><Iptc4xmpExt:DigitalSourceType>${AI_SOURCE_TYPE}</Iptc4xmpExt:DigitalSourceType>`
      + `<xmp:CreatorTool>${esc(a.model)}</xmp:CreatorTool><axal:card>${a.card + 1}</axal:card></rdf:li>`)).join('')}</rdf:Bag></axal:aiImages>`
    : '>';
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:axal="https://axal.vc/ns/deck/1.0/"'
    + ` pdfuaid:part="1"${aiPart}`
    + `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>`
    + `<dc:language><rdf:Bag><rdf:li>${esc(lang)}</rdf:li></rdf:Bag></dc:language>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>';
}
