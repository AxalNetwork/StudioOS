/**
 * D6897 part 2 (#6897, canvas D6054 RA-28 C, RA-30 B): what the A4 PDF copy of an evidence pack or a readiness
 * snapshot says, as plain data. Pure: no jsPDF here, so every word is testable; `lib/raiseSharePdf.js` draws it.
 *
 * The content is the Worker's frozen copy, the same object a link's reader receives, and the words are the reader
 * pages' own (`EvidencePackPage`, `ReadinessSnapshotPage`): an area with no score reads "Not scored yet", never 0;
 * Team reads "Team is assessed by a person"; a figure only where the founder shared it after an NDA, otherwise
 * Value withheld with its reason; a Mismatch is never hidden. The page is dated and says it does not update.
 *
 * A model is { filename, made, eyebrow, title, dated, shared?, line?, partial?, sections, foot }. A section is
 * { heading, columns, rows } (a table, every cell a string) or { heading, empty } (a sentence instead of a table).
 */
import { day, figure, itemTitle, sourceWord } from './evidenceView';
import { claimWord } from './evidenceModel';

export const COPY_LINE = 'A PDF is a copy: it cannot be stopped and its opens are not counted.';
const NR = 'Not recorded';
const STRENGTH = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const SAFE = /[^A-Za-z0-9]+/g;

/** `axal-<what>-<venture>-<day>.pdf`, ASCII only. */
export function pdfFilename(what, venture, madeAt) {
  const slug = String(venture || 'venture').replace(SAFE, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'venture';
  const d = /^\d{4}-\d{2}-\d{2}/.exec(String(madeAt || ''))?.[0] || 'undated';
  return `axal-${what}-${slug}-${d}.pdf`;
}

/** RA-30 B: the readiness snapshot. Seven areas, no overall score, no Product-market fit row. */
export function readinessPdfModel(snapshot) {
  const areas = Array.isArray(snapshot?.areas) ? snapshot.areas : null;
  const made = day(snapshot?.made_at) || NR;
  return {
    filename: pdfFilename('readiness', snapshot?.venture, snapshot?.made_at),
    made,
    eyebrow: `${snapshot?.venture || NR} · Readiness snapshot`,
    title: 'Fundraising readiness',
    dated: `Scores are as recorded on ${made}. This page does not update; ask the sender for a new one.`,
    line: snapshot?.covering_line || null,
    sections: [areas
      ? {
        heading: 'Readiness by area',
        columns: ['Area', 'Score', 'Evidence', 'What is missing', 'Scored'],
        widths: [0.2, 0.18, 0.13, 0.35, 0.14],
        rows: areas.map((a) => [a.label || NR, a.words || NR, a.evidence || '—', a.missing || '—', day(a.scored_on) || '—']),
      }
      : { heading: 'Readiness by area', empty: `${NR}.` }],
    foot: 'Scores are out of 10. An area without a score says so; it is never 0. Team is assessed by a person. Product-market fit and any overall score are not part of this page.',
  };
}

/** The value line an after-NDA reader sees for one item, as on the reader page. */
export function valueWords(row) {
  const shown = row?.value_reason ? null : figure(row?.value_num, row?.value_unit, row?.currency);
  if (shown) return shown;
  const r = row?.value_reason;
  if (r && r !== 'Shared as a summary only.' && r !== 'No figure is recorded for this item.') return `Value withheld: ${r}`;
  return r || NR;
}

/** RA-28 C: the evidence pack. Before an NDA, coverage only; after one, items, figures as shared, and claims. */
export function packPdfModel(pack) {
  const after = !!pack?.nda_signed;
  const made = day(pack?.made_at) || NR;
  const sections = [];
  if (!after) {
    const groups = pack?.coverage?.state === 'recorded' ? pack.coverage.groups : null;
    sections.push(groups
      ? {
        heading: 'What is on record',
        columns: ['Area', 'Kind', 'Source', 'How many', 'Newest'],
        widths: [0.26, 0.22, 0.22, 0.12, 0.18],
        rows: groups.map((g) => [g.area || NR, itemTitle(g), sourceWord(g.source_label) || NR, String(g.count ?? NR), day(g.newest) || NR]),
      }
      : { heading: 'What is on record', empty: `${NR}.` });
  } else {
    const items = pack?.items?.state === 'recorded' ? pack.items.rows : null;
    sections.push(items
      ? {
        heading: 'Evidence',
        columns: ['Area', 'Evidence', 'Source', 'Day', 'Strength', 'Value'],
        widths: [0.17, 0.17, 0.15, 0.12, 0.11, 0.28],
        rows: items.map((r) => [r.area || NR, itemTitle(r), sourceWord(r.source_label) || NR, day(r.observed_on) || 'Date not recorded', STRENGTH[r.strength] || NR, valueWords(r)]),
      }
      : { heading: 'Evidence', empty: `${NR}.` });
    const claims = pack?.claims?.state === 'recorded' ? pack.claims.rows : null;
    sections.push(claims && claims.length
      ? {
        heading: 'Claims these items back',
        columns: ['State', 'Checked', 'Founder’s note'],
        widths: [0.22, 0.18, 0.6],
        rows: claims.map((c) => [claimWord(c.state), c.checked_at ? day(c.checked_at) || NR : 'Not checked yet', c.founder_note || '—']),
      }
      : { heading: 'Claims these items back', empty: claims ? 'No claim is backed by these items.' : `${NR}.` });
  }
  return {
    filename: pdfFilename('evidence-pack', pack?.venture, pack?.made_at),
    made,
    eyebrow: `${pack?.venture || NR} · Evidence pack · ${after ? 'after an NDA' : 'before an NDA'}`,
    title: 'Evidence pack',
    dated: `This shows what was shared on ${made}; it does not update.`,
    shared: after
      ? `Shared after an NDA signed outside Axal${pack?.nda_signed_on ? ` on ${day(pack.nda_signed_on)}` : ''}.`
      : (pack?.before_nda || 'Figures, files and quotes open once the NDA is signed.'),
    partial: pack?.partial ? 'Some evidence could not be read when this pack was made, so it is not in it.' : null,
    line: null,
    sections,
    foot: 'Shared from Axal by the company’s founders. Private items, unconsented quotes and files the data room refuses are never in a pack.',
  };
}

/** What a PDF copy on Shared links shares, in the canvas's words. */
export function copyShares(copy) {
  if (copy?.output === 'readiness') return `Readiness snapshot · ${copy.item_count ?? NR} areas`;
  const n = copy?.item_count;
  const items = Number.isInteger(n) ? `${n} ${n === 1 ? 'item' : 'items'}` : NR;
  return `Evidence pack · ${items} · ${copy?.reader === 'after_nda' ? 'after NDA' : 'before NDA'}`;
}
