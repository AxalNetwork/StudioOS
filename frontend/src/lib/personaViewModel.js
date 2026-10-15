/**
 * D696: explicit export allowlist. Never spread a record into this model:
 * interviews, activity, actions and arbitrary sections do not belong in a persona.
 */
const line = (value, limit = 500) => {
  const plain = ['string', 'number', 'boolean'].includes(typeof value) ? String(value).replace(/\s+/g, ' ').trim() : '';
  const chars = Array.from(plain);
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : plain;
};
const sectionRows = (sections, key, title) => {
  const section = (sections ?? []).find((item) => item.key === key || String(item.title ?? '').toLowerCase() === title.toLowerCase());
  return section?.rows ?? [];
};
const rows = (source, limit) => ({
  rows: source.slice(0, limit).map((row) => ({ label: line(row.a, 80), value: line(row.b) })),
  omitted: Math.max(0, source.length - limit),
});

export function personaModel(record, { generatedAt = new Date() } = {}) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid generatedAt date is required.');
  return {
    title: line(record?.title, 500) || 'Persona',
    sub: line(record?.sub, 360),
    date: date.toISOString().slice(0, 10),
    facts: (record?.facts ?? []).slice(0, 4).map((fact) => ({
      label: line(fact.label, 80),
      value: fact.value == null ? 'Not recorded' : line(fact.value, 160),
      reason: fact.value == null ? line(fact.reason, 160) : '',
    })),
    steps: rows(sectionRows(record?.main, 'five-steps', 'Five steps'), 5),
    themes: rows(sectionRows(record?.side, 'pain-themes', 'Pain themes'), 8),
  };
}

export function personaFilename(model) {
  const slug = String(model.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '') || 'segment';
  return 'persona-' + slug + '-' + model.date + '.pdf';
}
