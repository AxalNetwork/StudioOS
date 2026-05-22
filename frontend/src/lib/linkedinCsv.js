// Task #70 — shared LinkedIn "Connections.csv" parser. Extracted from
// ReferEarnPage so the Settings → Integrations CSV import modal can
// reuse the exact same parsing semantics (header detection, quoted
// fields, First/Last/Email Address columns) without code duplication.
//
// LinkedIn's export starts with a 3-5 line human-readable "Notes:"
// preamble BEFORE the real header row, so we scan the first 10 lines
// for one that contains both "First Name" and "Email Address". If we
// don't find it (e.g. the user uploaded a plain name,email CSV), we
// fall back to the generic two-column parser.

function parseGenericCsv(text) {
  if (!text) return [];
  const lines = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (cur.length > 0) lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length === 0) return [];
  const splitRow = (line) => {
    const out = [];
    let f = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { f += '"'; i++; continue; }
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(f); f = ''; continue; }
      f += ch;
    }
    out.push(f);
    return out.map(s => s.trim());
  };
  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const nameIdx = header.findIndex(h => h === 'name' || h === 'full name');
  const emailIdx = header.findIndex(h => h === 'email' || h === 'email address');
  if (emailIdx === -1) return [];
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitRow(lines[li]);
    const email = (cols[emailIdx] || '').trim();
    if (!email || !email.includes('@')) continue;
    const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '';
    rows.push({ email, name });
  }
  return rows;
}

export function parseLinkedInCsv(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const allLines = text.split(/\r\n|\n|\r/);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 10); i++) {
    const lc = allLines[i].toLowerCase();
    if (lc.includes('first name') && lc.includes('email address')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return parseGenericCsv(text);

  const trimmed = allLines.slice(headerIdx).join('\n');
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"' && trimmed[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && trimmed[i + 1] === '\n') i++;
      if (cur.length > 0) lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length === 0) return [];

  const splitRow = (line) => {
    const out = [];
    let f = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { f += '"'; i++; continue; }
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(f); f = ''; continue; }
      f += ch;
    }
    out.push(f);
    return out.map(s => s.trim());
  };

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const firstIdx = header.findIndex(h => h === 'first name');
  const lastIdx = header.findIndex(h => h === 'last name');
  const emailIdx = header.findIndex(h => h === 'email address' || h === 'email');
  if (emailIdx === -1) return [];

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitRow(lines[li]);
    const email = (cols[emailIdx] || '').trim();
    if (!email || !email.includes('@')) continue;
    const first = firstIdx >= 0 ? (cols[firstIdx] || '').trim() : '';
    const last = lastIdx >= 0 ? (cols[lastIdx] || '').trim() : '';
    const name = [first, last].filter(Boolean).join(' ').trim();
    rows.push({ email, name });
  }
  return rows;
}

// Storage key used to hand a freshly-imported batch from Settings →
// Integrations across to the Refer & Earn page, so the user can send
// the invites without re-uploading. ReferEarnPage reads + clears this
// on mount.
export const PENDING_LINKEDIN_IMPORT_KEY = 'pending_linkedin_csv_import';
