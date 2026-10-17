import React, { useState } from 'react';
import { Mail, Link2, Check } from 'lucide-react';
import BrandIcon from '../ui/BrandIcon.jsx';

// Shared social-share row.
//
// The brand glyphs below were previously duplicated verbatim in
// ArticleReaderPage.jsx and (the X mark) AuthorCard.jsx. Founder landing pages
// need the same row, so rather than add a third copy the glyphs + the intent
// URLs live here once. The existing call sites are deliberately left alone in
// this change — they render a different, article-specific layout — but they can
// now drop their local copies whenever they're next touched.
//
// Every target is a plain link to the network's public share intent: no SDKs,
// no third-party script, no tracking pixel. WhatsApp and Email are included
// because founders share pages one-to-one at least as often as they broadcast.

/**
 * @param {string} url    the PUBLIC url being shared (already absolute)
 * @param {string} title  used as the tweet text / mail subject
 * @param {string} [size] 'sm' for the compact row used inside page cards
 */
export default function ShareButtons({ url, title, size = 'md', className = '' }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!url) return null;

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title || 'Take a look');
  const sm = size === 'sm';

  const targets = [
    { key: 'x', label: 'Share on X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'linkedin', label: 'Share on LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: 'facebook', label: 'Share on Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'whatsapp', label: 'Share on WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
    { key: 'email', label: 'Share by email', Icon: Mail, href: `mailto:?subject=${t}&body=${t}%0A%0A${u}` },
  ];

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and absent over plain http — say so
      // rather than silently appearing to succeed.
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  };

  const btn = `inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-300 dark:hover:border-violet-700 transition ${sm ? 'w-7 h-7' : 'w-8 h-8'}`;
  const glyph = sm ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="group" aria-label="Share this page">
      {targets.map(({ key, label, Icon, href }) => (
        <a
          key={key}
          href={href}
          target={key === 'email' ? undefined : '_blank'}
          rel={key === 'email' ? undefined : 'noopener noreferrer'}
          aria-label={label}
          title={label}
          className={btn}
          data-testid={`share-${key}`}
        >
          {Icon ? <Icon className={glyph} /> : <BrandIcon provider={key} size={sm ? 12 : 14} variant="bare" tone="current" className={glyph} />}
        </a>
      ))}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Link copied' : 'Copy link'}
        title={copied ? 'Link copied' : 'Copy link'}
        className={`${btn} ${copied ? 'text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700' : ''}`}
        data-testid="share-copy"
      >
        {copied ? <Check className={glyph} /> : <Link2 className={glyph} />}
      </button>
      {/* Announce the outcome to screen readers without shifting layout. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
      {copyFailed && (
        <span className="text-[10.5px] text-amber-600 dark:text-amber-400">Copy failed — select the URL manually</span>
      )}
    </div>
  );
}
