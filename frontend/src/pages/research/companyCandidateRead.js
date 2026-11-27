/**
 * Readings for one competitor row. Pure, so the page and the tests share them.
 *
 * A candidate hangs off one analysis. Category is how it sits in that run.
 * Origin is how it got there. Relevance may be blank. Relationship, headcount
 * and funding are not fields, so nothing here names them.
 */

const CAT = { direct: 'Direct', adjacent: 'Adjacent' };

export function categoryLabel(value) {
  return CAT[value] || 'Direct';
}

/**
 * A stored 0 with no subscores is the column default, not a measurement.
 * A 0 that arrived with subscores is a score of zero and is shown as such.
 * Null is never printed as 0.
 */
export function recordedRelevance(candidate) {
  const raw = candidate?.relevance_score;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const scores = candidate?.scores;
  const hasScores = scores && typeof scores === 'object' && Object.keys(scores).length > 0;
  if (!hasScores && n === 0) return null;
  return Math.round(n);
}

export function keepNote(origin) {
  if (origin === 'manual') return 'Kept when this analysis is re-run.';
  return 'A re-run may replace this row unless you add it again by hand.';
}

export function originSub(origin) {
  if (origin === 'manual') return 'typed by hand, kept on re-run';
  if (origin === 'known') return 'named before the scan';
  if (origin === 'discovered') return 'found by the scan';
  return 'how this row got here is not recorded';
}

export function removeConsequence(origin) {
  if (origin === 'manual') return 'A re-run will not bring a manual row back unless you add it again.';
  if (origin === 'known') return 'A re-run names this company again if it is still on the known list.';
  return 'A re-run may find this company again. Removing it does not stop the scan.';
}

export function othersNote(total) {
  const n = Math.max(0, Number(total) - 1);
  if (!Number.isFinite(n)) return 'other competitors in this run are not recorded';
  if (n === 1) return '1 other competitor in this run';
  return `${n} other competitors in this run`;
}

export function exampleHost(value) {
  try {
    const raw = new URL(String(value)).hostname.toLowerCase();
    const host = raw.endsWith('.') ? raw.slice(0, -1) : raw;
    return host === 'example.com' || host === 'www.example.com';
  } catch {
    return false;
  }
}

export function httpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

/** The sentence above the buttons. It describes the draft; it is not the draft. */
export function draftExplanation(summary, sources) {
  const titles = sourceTitles(sources);
  const hasSum = Boolean(String(summary || '').trim());
  if (!hasSum && !titles.length) return 'Add a summary or a source first.';
  const srcBit = titles.length
    ? `${titles.length} source ${titles.length === 1 ? 'title' : 'titles'} (${titles.join(', ')})`
    : '';
  const what = hasSum && srcBit ? `the summary and ${srcBit}` : (hasSum ? 'the summary' : srcBit);
  return `Draft concatenates only what is already here: ${what}. It adds no source and invents no fact.`;
}

/** What Accept writes into the summary. Summary text and source titles, nothing else. */
export function draftText(summary, sources) {
  const titles = sourceTitles(sources);
  const sum = String(summary || '').trim();
  return [sum, titles.join(', ')].filter(Boolean).join('\n\n');
}

function sourceTitles(sources) {
  return (sources || []).map((s) => String(s?.title || '').trim()).filter(Boolean);
}

export function detailRows(details) {
  const d = details && typeof details === 'object' ? details : {};
  const features = Array.isArray(d.features) ? d.features.map((x) => String(x).trim()).filter(Boolean) : [];
  const pricing = Array.isArray(d.pricing)
    ? d.pricing.map((x) => String(x).trim()).filter(Boolean)
    : (typeof d.pricing === 'string' && d.pricing.trim() ? [d.pricing.trim()] : []);
  const positioning = typeof d.positioning === 'string' ? d.positioning.trim() : '';
  const traction = typeof d.traction === 'string' ? d.traction.trim() : '';
  return [
    features.length ? { k: 'Features', chips: features } : { k: 'Features', nr: true },
    pricing.length ? { k: 'Pricing', text: pricing.join(', ') } : { k: 'Pricing', nr: true },
    positioning ? { k: 'Positioning', text: positioning } : { k: 'Positioning', nr: true },
    traction ? { k: 'Traction', text: traction } : { k: 'Traction', nr: true },
  ];
}
