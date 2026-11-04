/**
 * D690 (#1691, test 10) — the Customer research table's separate consent columns. The
 * adapter maps the Worker's labels to its cells by position, so the keys line
 * and the State cell ship with the Worker's new labels: each column draws its
 * own cell, State reads decision 9's words, and no column draws a channel.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_columns_d690.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { cellView } from '../src/pages/cycles/cycleModel.js';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { RECORDS, STATE } from '../src/pages/cycles/adapters/validate.js';

const h = React.createElement;
const LABELS = ['Interviewee', 'Company', 'Date', 'ICP fit', 'Recording consent', 'Quotes OK', 'State'];
const ROW = {
  id: 7, interviewee: 'Mara Quill', company: 'Tallow & Co', date: '2026-10-02', icp_fit: 'strong',
  consent: 'agreed', channel: 'video', stage: 'done', state: 'ready',
};
const WORDS = {
  failed: 'Failed', recording: 'Recording',
  waiting_consent: 'Waiting for consent', consent_declined: 'Declined in WhatsApp', waiting_messages: 'Waiting for messages',
  waiting_transcript: 'Waiting for the call transcript', processing: 'Processing', ready: 'Ready to review',
  reviewed: 'Reviewed', lead: 'Lead', invited: 'Invited', booked: 'Booked', logged: 'Logged',
};
const records = (rows) => adaptRecords('validate', 'customer-research', { cols: LABELS, rows, total: rows.length, page: 1, page_size: 25 });

test('D690 decision 10: the consent labels each draw their own cell, ending in State', () => {
  const recs = records([ROW]);
  assert.deepEqual(recs.cols, [
    { key: 'interviewee', label: 'Interviewee' }, { key: 'company', label: 'Company' }, { key: 'date', label: 'Date' },
    { key: 'icp_fit', label: 'ICP fit' }, { key: 'recording_consent', label: 'Recording consent' }, { key: 'consent', label: 'Quotes OK' }, { key: 'state', label: 'State' },
  ]);
  const cells = recs.rows[0].cells;
  const shown = Object.fromEntries(recs.cols.map((c) => [c.label, cellView(cells[c.key]).text]));
  assert.deepEqual(shown, {
    Interviewee: 'Mara Quill', Company: 'Tallow & Co', Date: '2026-10-02', 'ICP fit': 'Strong', 'Recording consent': 'Not asked', 'Quotes OK': 'Agreed · deck-eligible', State: 'Ready to review',
  });
});

test('D690 decision 9: State maps every key the Worker sends to its words; none is Not recorded', () => {
  assert.deepEqual(STATE, WORDS);
  for (const [key, words] of Object.entries(WORDS)) {
    assert.equal(cellView(RECORDS['customer-research'].row({ ...ROW, state: key }).cells.state).text, words, key);
  }
  assert.deepEqual(cellView(RECORDS['customer-research'].row({ ...ROW, state: null }).cells.state), { text: 'Not recorded', nr: true });
});

test('D690 decision 10: no column draws a channel, though the row keeps its channel cell', () => {
  const recs = records([ROW]);
  assert.equal(recs.cols.some((c) => c.key === 'channel' || c.key === 'stage'), false);
  assert.equal(cellView(recs.rows[0].cells.channel).text, 'Call', 'the cell stays for the record page');
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(RecordsTable, { title: 'Interviews', records: recs })));
  // The grid itself, header row to the last row; Channel stays a filter above it.
  const start = html.indexOf('role="row"');
  const end = html.indexOf('data-testid="records-count"');
  assert.ok(start > 0 && end > start, 'the grid is drawn');
  const text = renderedText(`<div ${html.slice(start, end)}`);
  assert.ok(text.includes('State'), 'the State heading is drawn');
  assert.ok(text.includes('Ready to review'));
  assert.equal(text.includes('Call'), false, 'no channel under a State heading');
  assert.equal(text.includes('Channel'), false);
  assert.ok(renderedText(html).includes('Channel: all'), 'Channel is still a filter');
});

test('#4411: recording pills show the method in words and never borrow the quote status', () => {
  const cell = (recording_consent, consent = 'agreed') => RECORDS['customer-research'].row({ ...ROW, recording_consent, consent }).cells;
  for (const [method, words] of [['verbal', 'Said yes out loud'], ['written', 'In writing'], ['in_app', 'In the app'], ['pre_agreed', 'Agreed beforehand']]) {
    assert.deepEqual(cell({ status: 'given', method }, null).recording_consent, { text: `Given · ${words}`, tone: 'ok' });
    assert.deepEqual(cell({ status: 'given', method }, null).consent, { text: 'Not asked', tone: 'grey' });
  }
  assert.deepEqual(cell({ status: 'declined', method: 'verbal' }).recording_consent, { text: 'Declined', tone: 'bad' });
  assert.deepEqual(cell(undefined).recording_consent, { text: 'Not asked', tone: 'grey' });
  assert.deepEqual(cell({ status: 'not_recorded', method: 'written' }).recording_consent, { text: 'Not asked', tone: 'grey' });
  assert.deepEqual(cell({ status: 'given', method: 'unrecognised' }).recording_consent, { text: 'Given', tone: 'ok' });
  assert.deepEqual(cell(undefined).consent, { text: 'Agreed · deck-eligible', tone: 'ok' });
  const filters = RECORDS['customer-research'].filters;
  assert.deepEqual(filters.find(f => f.key === 'recording_consent'), { key: 'recording_consent', label: 'Recording consent', options: [
    { value: 'given', label: 'Given' }, { value: 'declined', label: 'Declined' }, { value: 'not_asked', label: 'Not asked' },
  ] });
  assert.equal(filters.find(f => f.key === 'consent').label, 'Quotes OK');
  assert.equal(filters.find(f => f.key === 'consent').options[0].label, 'Agreed · deck-eligible');
});
