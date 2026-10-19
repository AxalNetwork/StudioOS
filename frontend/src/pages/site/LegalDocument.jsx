import React from 'react';
import SitePage from '../../components/site/SitePage';
import { Eyebrow } from '../../components/site/SiteBlocks';
import './contact.css';

/**
 * D680 — the owner's canvas LEGAL PAGES layout, shared by `/terms`,
 * `/privacy` and `/risk-disclosures`: the "Legal" eyebrow, the title, "Last
 * updated" in mono, the intro, numbered sections (number and heading, then the
 * body) and the questions line.
 *
 * THE WORDS ARE THE PAGES' OWN (option A on #1554). Each page passes the text
 * it carried before D680, re-laid out: its headings are the sections, its date
 * is "Last updated", and the address it already printed is the one the
 * questions line names. The canvas's own legal text waits on the owner and
 * counsel, and `contact_legal_cookies_d680.test.mjs` fails if any of it
 * appears here.
 *
 * `sections` is a list of `{ n, h, body }`: `n` is the page's own number,
 * zero-padded as the canvas draws it, or null for an unnumbered closing
 * section; `body` is the section's JSX.
 *
 * D756 (#1894): `version`, when set, follows "Last updated" as "· Notice
 * version <n>", and `notice` is drawn under that line; without `email` there
 * is no questions line. The three D680 pages pass neither and render as before.
 */
export default function LegalDocument({ title, updated, intro, sections, email, version, notice }) {
  return (
    <SitePage title={title}>
      <article className="ax-wrap ax-legal" aria-labelledby="ax-legal-h">
        <Eyebrow muted>Legal</Eyebrow>
        <h1 id="ax-legal-h" className="ax-legal-h1">{title}</h1>
        <div className="ax-mono ax-legal-updated">{version != null ? `Last updated ${updated} · Notice version ${version}` : `Last updated ${updated}`}</div>
        {notice}
        <div className="ax-legal-intro">{intro}</div>
        <div className="ax-legal-sections">
          {sections.map((s, i) => {
            const id = `ax-legal-s${i}`;
            return (
              <section key={s.h} className="ax-legal-section" aria-labelledby={id}>
                <div className="ax-legal-sh">
                  {s.n && <span className="ax-mono ax-legal-n">{s.n}</span>}
                  <h2 id={id} className="ax-legal-h2">{s.h}</h2>
                </div>
                <div className={`ax-legal-body${s.n ? '' : ' is-flush'}`}>{s.body}</div>
              </section>
            );
          })}
        </div>
        {email && (
          <div className="ax-legal-q">
            Questions about this document? Write to <a href={`mailto:${email}`}>{email}</a>.
          </div>
        )}
      </article>
    </SitePage>
  );
}
