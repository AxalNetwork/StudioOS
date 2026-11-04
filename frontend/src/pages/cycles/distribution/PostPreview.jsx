/** D4489 — unscaled platform frames, horizontally scrollable in narrow cards. */
import { PREVIEW_WIDTHS } from './calendarModel';
export default function PostPreview({ platform = 'linkedin', text = '', author, image }) {
  const name = String(platform).toLowerCase(); const key = Object.keys(PREVIEW_WIDTHS).find(k => k === 'x' ? /^(x|twitter)$/.test(name) : name.includes(k)); const width = PREVIEW_WIDTHS[key];
  if (!width) return <p>Not recorded: no preview for this channel.</p>;
  return <div className="max-w-full overflow-x-auto" aria-label="Preview at its real size"><article style={{ width, minWidth: width }} className="rounded-xl border bg-white p-4 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
    <header className="mb-3 font-bold">{author || 'Author not recorded'}{key === 'x' && <span> · Handle not recorded</span>}</header>
    <p className="whitespace-pre-wrap">{text || 'Copy not recorded'}</p>
    {image ? <img src={image} alt="Post attachment" className="w-full object-cover" style={{ height: key === 'youtube' ? undefined : 288, aspectRatio: key === 'youtube' ? '9 / 16' : undefined }} /> : <div className="flex items-center justify-center bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" style={{ height: key === 'youtube' ? undefined : 288, aspectRatio: key === 'youtube' ? '9 / 16' : undefined }}>Image not recorded</div>}
    {key === 'linkedin' && <footer>Like · Comment · Repost · Send</footer>}
    {key === 'facebook' && <footer>Like · Comment · Share</footer>}
    {key === 'x' && <footer>{Array.from(text).length} / 280 characters</footer>}
    {key === 'youtube' && <footer>Duration not recorded</footer>}
  </article></div>;
}
