/** Frozen, audience-scoped report projection and isolated browser printing (#6094). */
import { sourceChip, sourceLine, valueText } from '../builderModel.js';
import { text } from '../../../../lib/absence.js';

const list = (value) => Array.isArray(value) ? value : [];

/** No store reads, recipients or hidden team figures enter the printable document. */
export function reportPrintData(report, { reader = report?.view !== 'team', company = 'the company' } = {}) {
  if (report?.status !== 'sent' || !report.sent_at) throw new Error('Only a sent report can be printed.');
  return {
    title: text(report.title, `${text(report.period?.label, 'Period not recorded')} report`),
    company,
    period: text(report.period?.label),
    dates: [report.period?.start, report.period?.end].filter(Boolean).join(' – '),
    revision: Number.isInteger(report.revision) && report.revision > 0 ? String(report.revision) : 'Not recorded',
    sent: String(report.sent_at),
    correction: report.correction_reason ? String(report.correction_reason) : null,
    corrected: report.corrected_by ? `Corrected by revision ${text(report.corrected_by.revision)}${report.corrected_by.corrected_on ? ` · ${report.corrected_by.corrected_on}` : ''}` : null,
    figures: list(report.figures)
      .filter((f) => f && (!reader || !f.team_only || f.shared || f.shared_from_mercury))
      .map((f) => {
        const excluded = reader ? f.left_out || f.included === false : !f.included;
        return {
          label: text(f.label),
          value: excluded ? 'Not included' : valueText(f) ?? text(f.reason),
          source: excluded ? text(f.left_out_reason, 'No reason was given')
            : f.shared_from_mercury ? 'Connector · Mercury · shared by the founder' : sourceChip(f, company),
          asOf: text(f.as_of),
        };
      }),
    lines: ['highlights', 'lowlights'].flatMap((kind) => list(report[kind]).map((line) => ({
      kind: kind === 'highlights' ? 'Highlight' : 'Lowlight', text: text(line?.text), source: sourceLine(line),
    }))),
    body: report.body ? String(report.body) : null,
    documents: list(report.documents).map((d) => text(d.label || d.filename)),
  };
}

/** Text nodes preserve narrative literally; no report field is interpreted as HTML. */
export function renderReportPrint(doc, data) {
  const add = (parent, tag, value) => {
    const el = doc.createElement(tag);
    if (value != null) el.textContent = value;
    parent.appendChild(el);
    return el;
  };
  doc.title = data.title;
  doc.documentElement.lang = 'en';
  const article = add(doc.body, 'article');
  add(article, 'h1', data.title);
  add(article, 'p', `Report from ${data.company}`);
  add(article, 'p', `Period: ${data.period}${data.dates ? ` · ${data.dates}` : ''}`);
  add(article, 'p', `Revision ${data.revision} · Sent ${data.sent}`);
  if (data.correction) add(article, 'p', `Correction: ${data.correction}`);
  if (data.corrected) add(article, 'p', data.corrected);
  add(article, 'h2', 'Frozen figures');
  if (!data.figures.length) add(article, 'p', 'No figures are recorded in this report.');
  else {
    const table = add(article, 'table');
    const head = add(add(table, 'thead'), 'tr');
    for (const label of ['Figure', 'Value', 'Source', 'As of']) add(head, 'th', label).scope = 'col';
    const body = add(table, 'tbody');
    for (const f of data.figures) {
      const row = add(body, 'tr');
      for (const value of [f.label, f.value, f.source, f.asOf]) add(row, 'td', value);
    }
  }
  if (data.lines.length) {
    add(article, 'h2', 'Highlights and lowlights');
    for (const line of data.lines) {
      const section = add(article, 'section');
      add(section, 'p', `${line.kind}: ${line.text}`);
      add(section, 'small', line.source);
    }
  }
  if (data.body) { add(article, 'h2', 'Narrative'); add(article, 'p', data.body).className = 'narrative'; }
  if (data.documents.length) {
    add(article, 'h2', 'Attached documents');
    const items = add(article, 'ul');
    for (const name of data.documents) add(items, 'li', name);
    add(article, 'p', 'Download attached documents separately from the report.');
  }
  return article;
}

/** An iframe gives native Print/Save as PDF only this report, including from a reader sheet. */
export async function printReport(report, options = {}, owner = document) {
  const data = reportPrintData(report, options);
  const frame = owner.createElement('iframe');
  frame.title = 'Print sent report';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;inset:0;';
  const opener = owner.activeElement;
  let timer;
  const cleanup = () => {
    owner.defaultView.removeEventListener('pagehide', cleanup);
    owner.defaultView.clearTimeout(timer);
    frame.remove();
    if (opener?.isConnected) opener.focus?.();
  };
  owner.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) throw new Error('Print document unavailable');
    const style = doc.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./reportPrint.css', import.meta.url).href;
    await new Promise((resolve, reject) => {
      const timeout = owner.defaultView.setTimeout(() => reject(new Error('Print stylesheet unavailable')), 15_000);
      style.onload = () => { owner.defaultView.clearTimeout(timeout); resolve(); };
      style.onerror = () => { owner.defaultView.clearTimeout(timeout); reject(new Error('Print stylesheet unavailable')); };
      doc.head.appendChild(style);
    });
    renderReportPrint(doc, data);
    frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
    owner.defaultView.addEventListener('pagehide', cleanup, { once: true });
    // Safari can return before its print dialog closes; retain the document until afterprint.
    timer = owner.defaultView.setTimeout(cleanup, 600_000);
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch (error) { cleanup(); throw error; }
}
