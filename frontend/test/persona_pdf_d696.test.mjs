/**
 * D696: one-page persona with measured clipping and an explicit content allowlist.
 * Uses the real renderer against the shared jsPDF AFM recording stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personaModel, personaFilename } from '../src/lib/personaViewModel.js';
import { renderPersona, exportPersonaPdf } from '../src/lib/personaPdf.js';
import { createPdfStub } from './_pdf-stub.mjs';
import { fixture, sourceModule, mutate, mutationCheck } from './_record_d696.mjs';

const stamp = new Date('2026-10-15T23:45:00.000Z');
const modelSource = readFileSync(new URL('../src/lib/personaViewModel.js', import.meta.url), 'utf8');
const pdfSource = readFileSync(new URL('../src/lib/personaPdf.js', import.meta.url), 'utf8');
const textOf = (doc) => doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join('\n');

function assertModel(m) {
  const r = fixture(); const model = m.personaModel(r, { generatedAt: stamp });
  assert.equal(model.title, r.title); assert.equal(model.sub, r.sub);
  assert.equal(model.date, '2026-10-15');
  assert.equal(model.facts.length, 4);
  assert.deepEqual(model.facts[0], { label: 'Interviews', value: '0', reason: '' });
  assert.equal(model.facts[2].value, 'Not recorded');
  assert.equal(model.facts[2].reason, r.facts[2].reason);
  assert.deepEqual(model.steps.rows, r.main[1].rows.map((row) => ({ label: row.a, value: row.b })));
  assert.deepEqual(model.themes.rows, [{ label: 'Scheduling', value: 'Lost hours' }]);
  for (const value of ['Mira Sampleton', 'mira@example.invalid', 'Interviews scored against it', 'Harbour segment created', 'Delete this record?', 'Waiting costs us time']) assert.ok(!JSON.stringify(model).includes(value), value);
  assert.equal(m.personaFilename(model), 'persona-harbour-operators-2026-10-15.pdf');
  assert.equal(m.personaFilename({ ...model, title: '../../A / B? <tag>' }), 'persona-a-b-tag-2026-10-15.pdf');
  assert.equal(m.personaFilename({ ...model, title: '你好' }), 'persona-segment-2026-10-15.pdf');
  assert.throws(() => m.personaModel(r, { generatedAt: 'invalid' }), TypeError);
  const byKey = fixture(); byKey.main[1].title = 'Translated steps'; byKey.side[0].title = 'Translated themes';
  assert.equal(m.personaModel(byKey, { generatedAt: stamp }).steps.rows.length, 5);
  assert.equal(m.personaModel(byKey, { generatedAt: stamp }).themes.rows.length, 1);
  const absent = m.personaModel({ title: 'Empty', main: r.main.filter((s) => s.key !== 'five-steps'), side: [] }, { generatedAt: stamp });
  assert.deepEqual(absent.steps, { rows: [], omitted: 0 }); assert.deepEqual(absent.themes, { rows: [], omitted: 0 });
}

test('the persona model carries only segment title, facts, steps and themes', async () => {
  assertModel({ personaModel, personaFilename });
  await mutationCheck(modelSource, 'lib/personaViewModel.js', assertModel, [
    ["title: line(record?.title, 500)", "title: 'Persona'"],
    ['value: fact.value == null', 'value: !fact.value'],
    ["sectionRows(record?.main, 'five-steps', 'Five steps')", "(record?.main ?? []).flatMap((section) => section.rows)"],
    ["sectionRows(record?.side, 'pain-themes', 'Pain themes')", '[]'],
    ["return 'persona-' + slug", "return 'export-' + slug"],
    ["item.key === key ||", 'false ||'],
  ]);
});

function longest() {
  const r = fixture(); const huge = 'W'.repeat(6000);
  r.title = huge; r.sub = huge;
  r.facts = r.facts.map((f) => ({ ...f, label: huge, value: huge }));
  r.main[1].rows = Array.from({ length: 30 }, () => ({ a: huge, b: huge }));
  r.side[0].rows = Array.from({ length: 30 }, () => ({ a: huge, b: huge }));
  return r;
}

function assertBudget(m) {
  const model = m.personaModel(longest(), { generatedAt: stamp });
  assert.equal(model.title.length, 500);
  assert.equal(model.steps.rows.length, 5); assert.equal(model.steps.omitted, 25);
  assert.equal(model.themes.rows.length, 8); assert.equal(model.themes.omitted, 22);
  assert.ok(model.title.endsWith('…')); assert.ok(model.steps.rows[0].value.endsWith('…'));
  assert.ok(m.personaFilename(model).length < 100);
}
test('model bounds rows and long text before any PDF work', async () => {
  assertBudget({ personaModel, personaFilename });
  await mutationCheck(modelSource, 'lib/personaViewModel.js', assertBudget, [
    ["'Five steps'), 5", "'Five steps'), 30"],
    ["'Pain themes'), 8", "'Pain themes'), 30"],
    ["+ '…' : plain", "+ '' : plain"],
    ['.slice(0, 64)', '.slice(0, 500)'],
  ]);
});

function assertRendering(m) {
  const doc = createPdfStub(); const r = fixture();
  m.renderPersona(doc, personaModel(r, { generatedAt: stamp }));
  const out = textOf(doc);
  for (const value of [r.title, r.sub, 'Interviews', '0', 'Not recorded', r.facts[2].reason, 'Five steps', 'Pain themes', 'Scheduling', 'Lost hours', ...r.main[1].rows.flatMap((row) => [row.a, row.b])]) assert.ok(out.includes(value), value);
  assert.ok(!out.includes('Mira Sampleton')); assert.ok(!out.includes('mira@example.invalid'));
  for (const record of [longest(), { title: 'Empty' }]) {
    const pdf = createPdfStub(); m.renderPersona(pdf, personaModel(record, { generatedAt: stamp }));
    assert.equal(pdf.pageCount, 1); assert.equal(pdf.calls.some((c) => c.op === 'addPage'), false);
    assert.ok(pdf.maxY <= 792, 'letter height: ' + pdf.maxY);
    assert.ok(pdf.maxX <= 612, 'letter width: ' + pdf.maxX);
    const lines = pdf.calls.filter((c) => c.op === 'text');
    assert.ok(lines.every((c) => c.left >= 0 && c.left + c.width <= 612 && c.y >= 0 && c.y + c.height <= 792));
  }
  const long = createPdfStub(); m.renderPersona(long, personaModel(longest(), { generatedAt: stamp }));
  assert.match(textOf(long), /…/); assert.match(textOf(long), /25 more steps/); assert.match(textOf(long), /22 more themes/);
  const empty = createPdfStub(); m.renderPersona(empty, personaModel({ title: 'Empty' }, { generatedAt: stamp }));
  assert.equal((textOf(empty).match(/Nothing recorded here yet./g) || []).length, 2);
}

test('required content fits one letter page, including unbroken and overlong input', async () => {
  assertRendering({ renderPersona });
  await mutationCheck(pdfSource, 'lib/personaPdf.js', assertRendering, [
    ["write(model.title,", "write('Wrong title',"],
    ['write(fact.value,', "write('',"],
    ['write(row.value, 246, y,', "write('', 246, y,"],
    ['write(row.label, x, y,', "write('', x, y,"],
    ['let rest = String(value ?? \'\');', "let rest = String(value ?? ''); if (rest.length > 100) return [rest];"],
    ["b.hline(40, 776, 1000, EDGE);", "doc.addPage(); b.hline(40, 776, 1000, EDGE);"],
    ["y = 790 + Math.floor(index / 2) * 44", "y = 790 + Math.floor(index / 2) * 440"],
  ]);
});

test('client export dynamically loads jsPDF, renders and saves the safe dated filename', async () => {
  assert.equal(typeof exportPersonaPdf, 'function');
  // Replace only the optional dependency seam: the real model, renderer and save path run.
  const verify = async (source) => {
    const doc = createPdfStub(); let options; let properties;
    doc.setProperties = (p) => { properties = p; };
    globalThis.__d696JsPDF = class { constructor(o) { options = o; return doc; } };
    try {
      const seam = mutate(source, "await import('jspdf')", '({ jsPDF: globalThis.__d696JsPDF })');
      const module = await sourceModule(seam, 'lib/personaPdf.js');
      const result = await module.exportPersonaPdf(fixture(), { generatedAt: stamp });
      assert.deepEqual(options, { orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
      assert.equal(properties.title, 'Persona');
      assert.ok(!JSON.stringify(properties).includes('Mira'));
      assert.deepEqual(result, { filename: 'persona-harbour-operators-2026-10-15.pdf' });
      assert.deepEqual(doc.calls.filter((c) => c.op === 'save'), [{ op: 'save', name: result.filename }]);
      assert.ok(textOf(doc).includes('Port operations leads'));
    } finally { delete globalThis.__d696JsPDF; }
  };
  await verify(pdfSource);
  for (const [before, after] of [
    ['doc.save(filename);', ''],
    ['renderPersona(doc, model);', ''],
    ["format: 'letter'", "format: 'a4'"],
  ]) await assert.rejects(() => verify(mutate(pdfSource, before, after)), { name: 'AssertionError' });
  await verify(pdfSource);
});
