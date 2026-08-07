import React, { useState } from 'react';
import { Mail, Link2, Check } from 'lucide-react';

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

function XIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function LinkedinIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
function FacebookIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.884v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}
function WhatsappIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.465 3.488" />
    </svg>
  );
}

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
    { key: 'x', label: 'Share on X', Icon: XIcon, href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'linkedin', label: 'Share on LinkedIn', Icon: LinkedinIcon, href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: 'facebook', label: 'Share on Facebook', Icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'whatsapp', label: 'Share on WhatsApp', Icon: WhatsappIcon, href: `https://wa.me/?text=${t}%20${u}` },
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
          <Icon className={glyph} />
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
