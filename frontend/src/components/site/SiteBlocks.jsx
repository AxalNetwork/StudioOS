import React from 'react';
import { Link } from 'react-router-dom';

/**
 * The building blocks the public site's pages share (D675–D680, #1546), drawn
 * from the owner's website canvas. Each is presentational: it takes its words
 * and its data as props, so a page decides what is live and what is copy.
 * Classes live in `site.css`.
 */

/** A small uppercase label above a heading. `muted` uses the grey tone. */
export function Eyebrow({ children, muted = false, className = '' }) {
  return <div className={`${muted ? 'ax-lbl-q' : 'ax-lbl'} ${className}`.trim()}>{children}</div>;
}

/**
 * An eyebrow, a heading and an optional lede. `id` labels the section that
 * holds it; `as` picks the heading level (h1 on a page's first block).
 */
export function SectionHead({ eyebrow, title, lede, id, as = 'h2', muted = false, className = '', children }) {
  const H = as;
  return (
    <div className={`ax-shead ${className}`.trim()}>
      {eyebrow && <Eyebrow muted={muted}>{eyebrow}</Eyebrow>}
      <H id={id} className={as === 'h1' ? 'ax-h1 ax-h1-page' : 'ax-h2'}>{title}</H>
      {lede && <p className="ax-lede">{lede}</p>}
      {children}
    </div>
  );
}

/** One section: the page's width, its vertical rhythm, and an optional wash band. */
export function Section({ id, labelledBy, band = false, dark = false, className = '', children, narrow = false }) {
  const inner = <div className={`ax-wrap ax-section ${narrow ? 'ax-narrow' : ''}`.trim()}>{children}</div>;
  const cls = `${band ? 'ax-band' : ''} ${dark ? 'ax-dark' : ''} ${className}`.trim();
  return (
    <section id={id} aria-labelledby={labelledBy} className={cls || undefined}>
      {inner}
    </section>
  );
}

/**
 * A page's opening block over an image. `tone="dark"` puts light type on a
 * darkened image; the default is the canvas's white-washed hero. The image is
 * decorative unless `imageAlt` is given.
 */
export function PageHero({ eyebrow, title, copy, image, imageAlt = '', imagePosition = '60% 40%', tone = 'light', actions, id = 'ax-page-h', children }) {
  return (
    <section className={`ax-phero ax-phero-${tone}`} aria-labelledby={id}>
      {image && <img className="ax-phero-img" src={image} alt={imageAlt} style={{ objectPosition: imagePosition }} />}
      <div className="ax-phero-veil" aria-hidden="true" />
      <div className="ax-wrap ax-phero-body">
        {eyebrow && <div className={tone === 'dark' ? 'ax-lbl ax-lbl-light' : 'ax-lbl'}>{eyebrow}</div>}
        <h1 id={id} className="ax-h1 ax-h1-page">{title}</h1>
        {copy && (Array.isArray(copy) ? copy : [copy]).map((p) => <p key={String(p).slice(0, 40)} className="ax-phero-copy">{p}</p>)}
        {actions && <div className="ax-row-btns" style={{ marginTop: 30 }}>{actions}</div>}
        {children}
      </div>
    </section>
  );
}

/**
 * A button-styled link. Internal paths render a router `Link`; `href` renders
 * a plain anchor (mailto:, an external site). `variant` is one of primary,
 * bright, quiet, ghost.
 */
export function ButtonLink({ to, href, variant = 'primary', size = 'lg', children, ...rest }) {
  const cls = `ax-btn ax-btn-${size} ax-btn-${variant}`;
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>;
  return <Link to={to} className={cls} {...rest}>{children}</Link>;
}

/** The closing call to action over an image, as on the home page. */
export function CtaBand({ title, copy, image = '/site/door-founders.webp', actions, id = 'ax-cta-h' }) {
  return (
    <section className="ax-wrap" style={{ paddingTop: 64, paddingBottom: 96 }} aria-labelledby={id}>
      <div className="ax-close" style={{ backgroundImage: `url("${image}")` }}>
        <div className="ax-close-veil" aria-hidden="true" />
        <div style={{ position: 'relative', maxWidth: 560 }}>
          <h2 id={id}>{title}</h2>
          {copy && <p className="ax-close-copy" style={{ margin: 0 }}>{copy}</p>}
        </div>
        {actions && <div className="ax-row-btns" style={{ position: 'relative' }}>{actions}</div>}
      </div>
    </section>
  );
}

/**
 * Filter pills. `options` is a list of `{ value, label }` (or plain strings);
 * the one matching `value` is pressed.
 */
export function FilterPills({ options, value, onChange, label = 'Filter' }) {
  return (
    <div className="ax-pills" role="group" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        const on = opt.value === value;
        return (
          <button key={opt.value} type="button" className={`ax-pill${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(opt.value)}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Numbered questions and answers. */
export function FaqList({ items }) {
  return (
    <div className="ax-faq">
      {items.map((q, i) => (
        <div key={q.q} className="ax-faq-row">
          <div className="ax-mono ax-faq-n">{String(i + 1).padStart(2, '0')}</div>
          <div>
            <h3 className="ax-faq-q">{q.q}</h3>
            <p className="ax-faq-a">{q.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A plain sentence where a live list has nothing to show, or failed to load. */
export function EmptyNote({ children }) {
  return <p className="ax-empty">{children}</p>;
}

/** A figure and its label. Render one only when the value is real. */
export function Figure({ value, label, dark = false }) {
  return (
    <div className="ax-figure">
      <div className={`ax-mono ax-figure-v${dark ? ' is-dark' : ''}`}>{value}</div>
      <div className={dark ? 'ax-lbl ax-lbl-light' : 'ax-lbl-q'} style={{ marginTop: 6 }}>{label}</div>
    </div>
  );
}
