import React, { useEffect, useMemo, useState } from 'react';
import ImageToolbar from './ImageToolbar';
import { imageEditAi } from './deckV2Adapter';
import { liveTools, placedResult } from './imageToolsModel';
import { deckImageEditsApi } from '../../../lib/api/deckImageEdits.js';
import { deckImagesApi } from '../../../lib/api/deckImages.js';

/**
 * D1534 (#3778 phase 2): a placed image's toolbar with the AI image tools the
 * Worker has on. It reads `deckV2Adapter.imageEditAi` once per block; a tool's
 * run makes a proposed child image, which is kept and placed in the block's own
 * place (`placedResult`), so the block keeps its crop, filter and fit.
 * With every tool off (the switch, until the owner's steps on #1008) this is
 * exactly `ImageToolbar`, its tools greyed under "Coming later".
 */
export default function ImageToolbarLive(props) {
  const { block, onPatch, api = { edits: deckImageEditsApi, images: deckImagesApi }, adapter = imageEditAi } = props;
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(adapter()).then((a) => { if (live) setAnswer(a); }, () => { if (live) setAnswer(null); });
    return () => { live = false; };
  }, [block?.image_id, adapter]);
  const live = useMemo(() => liveTools(answer), [answer]);
  const tools = useMemo(() => (block?.image_id ? {
    quote: (tool) => api.edits.toolQuote(block.image_id, tool),
    run: async (tool) => {
      const key = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${tool}`;
      const made = await api.edits.runTool(block.image_id, tool, key);
      const kept = await api.images.keep(made.image.uid, { use: 'content', alt: made.image.alt || block.alt || '' });
      const patch = placedResult(kept?.image ?? made.image);
      if (patch) onPatch(patch);
    },
  } : null), [block?.image_id, block?.alt, api, onPatch]);
  return <ImageToolbar {...props} live={live} tools={tools} />;
}
