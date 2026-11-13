import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { articleAuthoringApi } from '../../lib/api/articleAuthoring.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import { railPressHeaders } from '../../lib/railPage';
import { reportError } from '../../lib/log';
import Sheet from '../../ui/Sheet';
import { ghost as actionGhost, primary as actionPrimary } from '../../ui/ActionSheet';
import {
  IMAGE_ASPECTS, IMAGE_PROMPT_MAX, IMAGE_STYLES, chargedLine, imageAsk, refusalMessage, usd,
} from './articleCanvas';

/**
 * D1408 (#3694) — AR4, "Generate an image" (D1409 part 2's routes).
 *
 * Describe, pick a style, an aspect and how many; the sheet quotes the price
 * per image and the hold before anything runs. Generate draws the variants;
 * the member picks one for the cover or the body, and every image not picked
 * is discarded (its bytes deleted). A cover is a copy of the pick, so the
 * pick's own file is discarded as well; a body image is kept (accepted). A real person is refused by the Worker
 * before any quote or charge, and the sheet says so in the canvas's words.
 *
 * `target` is 'cover' (16:9 by default) or 'body'. `onPlaced(image, target, coverUrl)`
 * is called after the pick is decided; the page puts it in place.
 */
const OPTION = 'draft:article-image';

export default function ArticleImageSheet({ articleId, target = 'cover', onClose, onPlaced }) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('illustration');
  const [aspect, setAspect] = useState(target === 'cover' ? '16:9' : '4:3');
  const [count, setCount] = useState(4);
  const [quote, setQuote] = useState(null);
  const [running, setRunning] = useState(false);
  const [images, setImages] = useState([]);
  const [stopped, setStopped] = useState(null);
  const [error, setError] = useState(null);
  const [placing, setPlacing] = useState(null);

  // Quote as the ask changes, once it is a valid ask.
  useEffect(() => {
    const built = imageAsk({ prompt, style, aspect, count });
    if (built.error) { setQuote(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      articleAuthoringApi.imagesQuote(articleId, built.ask)
        .then((q) => { if (live) { setQuote(q); setError(null); } })
        .catch((e) => { if (live) { setQuote(null); setError(refusalMessage(e)); } });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [articleId, prompt, style, aspect, count]);

  const generate = async () => {
    const built = imageAsk({ prompt, style, aspect, count });
    if (built.error) { setError({ text: built.error }); return; }
    setRunning(true);
    setError(null);
    setStopped(null);
    try {
      const r = await articleAuthoringApi.imagesGenerate(articleId, built.ask, railPressHeaders(OPTION));
      setImages(r.images || []);
      if (r.stopped) setStopped(refusalMessage({ data: { error: r.stopped.code } }));
    } catch (e) {
      reportError('ArticleImageSheet:generate', e);
      setError(refusalMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const discardAll = async (keep) => {
    await Promise.all(images.filter((img) => img.uid !== keep).map((img) => articleAuthoringApi.imageDiscard(articleId, img.uid).catch(() => {})));
  };

  const pick = async (img) => {
    setPlacing(img.uid);
    try {
      let coverUrl = null;
      if (target === 'cover') {
        // The cover is a copy (`cover-<uuid>`), so the drawn image is discarded too: no orphan bytes.
        const r = await articleAuthoringApi.coverFromImage(articleId, img.filename);
        coverUrl = r?.cover_url || null;
        await articleAuthoringApi.imageDiscard(articleId, img.uid).catch(() => {});
        await discardAll(img.uid);
      } else {
        await railProposalsApi.decide(img.uid, 'accept').catch((e) => { if (e?.status !== 409) throw e; });
        await discardAll(img.uid);
      }
      onPlaced?.(img, target, coverUrl);
    } catch (e) {
      reportError('ArticleImageSheet:pick', e);
      setError(refusalMessage(e));
    } finally {
      setPlacing(null);
    }
  };

  const close = async () => {
    if (images.length && !placing) await discardAll(null);
    onClose();
  };

  const balanceShort = quote?.ai && quote.balance && quote.balance.ok === false;
  const disabled = running || !quote || quote.ai === false || balanceShort;
  const footer = images.length ? (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={close} disabled={!!placing}>Discard all</button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={close}>Cancel</button>
      <button type="button" className={actionPrimary} onClick={generate} disabled={disabled} data-testid="article-image-generate">
        {running ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null} Generate {count} {count === 1 ? 'image' : 'images'}
      </button>
    </div>
  );

  return (
    <Sheet label="Generate an image" eyebrow={target === 'cover' ? 'Cover' : 'Article image'} title="Generate an image" onClose={close} width={560} testId="article-image-sheet" footer={footer}>
      {images.length > 0 ? (
        <div className="flex flex-col gap-3 px-5 py-4 text-[13px]">
          <p className="m-0">Pick one {target === 'cover' ? 'for the cover' : 'to place in the article'}. The others are deleted when you pick or close.</p>
          <div className="grid grid-cols-2 gap-3">
            {images.map((img) => (
              <button key={img.uid} type="button" onClick={() => pick(img)} disabled={!!placing}
                className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:ring-2 hover:ring-violet-500 disabled:opacity-60" data-testid="article-image-variant">
                <img src={img.url} alt="" className="w-full h-auto block" />
                {placing === img.uid && <span className="absolute inset-0 flex items-center justify-center bg-white/60"><Loader2 className="w-5 h-5 animate-spin" /></span>}
                <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">{chargedLine(img.charged_microusd ?? null, null)}</span>
              </button>
            ))}
          </div>
          {stopped && <div role="alert" className="text-xs text-amber-700 dark:text-amber-300">Stopped early: {stopped.text}</div>}
          {error && <div role="alert" className="text-xs text-red-700 dark:text-red-300">{error.text}</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4 text-[13px]">
          <div>
            <label htmlFor="article-image-prompt" className="text-xs text-slate-500 flex justify-between"><span>Describe the image</span><span>{prompt.length}/{IMAGE_PROMPT_MAX}</span></label>
            <textarea id="article-image-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, IMAGE_PROMPT_MAX))}
              placeholder="A calm workspace at dawn, a notebook and a cup of coffee" className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900" />
          </div>
          <fieldset>
            <legend className="text-xs text-slate-500 mb-1">Style</legend>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_STYLES.map((s) => (
                <button key={s.key} type="button" aria-pressed={style === s.key} onClick={() => setStyle(s.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${style === s.key ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-700'}`}>{s.label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs text-slate-500 mb-1">Aspect ratio</legend>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_ASPECTS.map((a) => (
                <button key={a.key} type="button" aria-pressed={aspect === a.key} onClick={() => setAspect(a.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${aspect === a.key ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-700'}`}>{a.label}{a.note ? ` · ${a.note}` : ''}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs text-slate-500 mb-1">Variants</legend>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}
                  className={`text-xs w-8 py-1 rounded border ${count === n ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-700'}`}>{n}</button>
              ))}
            </div>
          </fieldset>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-300" data-testid="article-image-quote">
            {quote?.ai ? (
              <>
                {count} {count === 1 ? 'variant' : 'variants'} · you pick one · {usd(quote.per_image_microusd)} per image · Holds up to {usd(quote.total_microusd)}
                <div className="mt-0.5">Images model {quote.model_label || quote.model} · Change in the AIRail</div>
                {balanceShort && <div className="mt-1 text-amber-700 dark:text-amber-300">{quote.balance.message || 'Your balance cannot cover this many images.'} <a className="underline" href="/account/usage/ai-tokens">Add tokens</a></div>}
              </>
            ) : quote && quote.ai === false ? (quote.message || 'Images are not available here right now.') : 'Describe the image to see its price.'}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
            Eadwyn does not draw real people: no faces, no named people, and no one from your company. Describe a scene, an object or an idea.
          </div>
          {error && <div role="alert" className="text-xs text-red-700 dark:text-red-300" data-testid="article-image-refusal">{error.text}{error.topUp && <> <a className="underline" href="/account/usage/ai-tokens">Add tokens</a></>}</div>}
        </div>
      )}
    </Sheet>
  );
}
