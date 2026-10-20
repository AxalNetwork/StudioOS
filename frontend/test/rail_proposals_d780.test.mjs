/**
 * D780 (#2105), part 1 — the SPA's half of `ai_rail_proposals`.
 *
 *   · H20 `draft:publication-summary`: Eadwyn's summary is offered beside the
 *     editor. "Put it in the summary" fills the open editor and writes nothing;
 *     the Super Admin's Save is the only write, and it names the proposal so the
 *     Worker keeps it as accepted or edited. Discard decides it and writes
 *     nothing else.
 *   · `draft:legal/notes`: the notes are read from the proposals store and drawn
 *     beside the document, never in its body. Keep and Dismiss decide the note.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_proposals_d780.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { railProposalsApi } from '../src/lib/api.js';

const read = (f) => codeOnly(readFileSync(`frontend/src/${f}`, 'utf8'));

test('the API module reaches the two Worker routes, and api.js re-exports it', () => {
  // Mutations checked: the re-export dropped; the decide body losing its payload.
  assert.equal(typeof railProposalsApi.list, 'function');
  assert.equal(typeof railProposalsApi.decide, 'function');
  const src = read('lib/api/railProposals.js');
  assert.match(src, /request\(`\/ai\/rail\/proposals\?\$\{q\}`\)/);
  assert.match(src, /request\(`\/ai\/rail\/proposals\/\$\{enc\(uid\)\}\/decide`/);
  assert.match(src, /JSON\.stringify\(payload \? \{ decision, payload \} : \{ decision \}\)/);
});

test('H20: the proposal fills the open editor only, and Save names it', () => {
  // Mutations checked: "Put it in the summary" calling the update route; Save
  // dropping the proposal's uid; Discard writing the summary.
  const page = read('pages/admin/PublicationDetail.jsx');
  const use = page.slice(page.indexOf('const useProposal = () => {'), page.indexOf('const discardProposal'));
  assert.match(use, /setSummary\(proposal\.text\);\s*setFromProposal\(proposal\.uid\);/);
  assert.doesNotMatch(use, /publications\.|railProposalsApi\./, 'filling the editor writes something');
  const discard = page.slice(page.indexOf('const discardProposal'), page.indexOf('const render = async'));
  assert.match(discard, /railProposalsApi\.decide\(proposal\.uid, 'discard'\)/);
  assert.doesNotMatch(discard, /publications\./, 'Discard writes the publication');
  const save = page.slice(page.indexOf('const save = async'), page.indexOf('const useProposal'));
  assert.match(save, /\.\.\.\(fromProposal \? \{ summary_proposal_uid: fromProposal \} : \{\}\)/);
  assert.match(page, /setProposal\(res\.summary_proposal \|\| null\);/, 'the detail page does not read the proposal');
});

test('legal notes: drawn beside the document from the proposals store, never in its body', () => {
  // Mutations checked: the notes read from the document; the notes drawn inside the body's <pre>.
  const page = read('pages/LegalCapitalPage.jsx');
  assert.match(page, /const LEGAL_NOTES_OPTION = 'draft:legal\/notes';/);
  assert.match(page, /railProposalsApi\.list\(\{ option: LEGAL_NOTES_OPTION, record: `legal_doc:\$\{docId\}` \}\)/);
  assert.match(page, /railProposalsApi\.decide\(uid, decision\)/);
  assert.doesNotMatch(page, /\.suggestions\b/, 'the page reads suggestions from the document');
  const viewer = page.slice(page.indexOf('function DocViewerModal'), page.indexOf('function CreateCallModal'));
  assert.match(viewer, /\{doc\.body\}<\/pre>\s*\{doc\.id \? <LegalNotes docId=\{doc\.id\} \/> : null\}/);
});

test('part 2, /admin/x alt text: generating proposes, "Use it" is the Save, Discard decides', () => {
  // Mutations checked: generating saving the caption; "Use it" dropping the proposal's uid;
  // Discard writing the post; the proposal not drawn beside its image.
  const page = read('pages/admin/AdminX.jsx');
  const gen = page.slice(page.indexOf('const genAlt = async'), page.indexOf('const useAlt = async'));
  assert.match(gen, /await api\.generateAltText\(id, idx\);/);
  assert.doesNotMatch(gen, /saveAltText|updatePost/, 'generating writes the post');
  const use = page.slice(page.indexOf('const useAlt = async'), page.indexOf('const discardAlt = async'));
  assert.match(use, /api\.saveAltText\(id, idx, proposal\.text, proposal\.uid\)/);
  const discard = page.slice(page.indexOf('const discardAlt = async'), page.indexOf('return (', page.indexOf('const discardAlt = async')));
  assert.match(discard, /railProposalsApi\.decide\(proposal\.uid, 'discard'\)/);
  assert.doesNotMatch(discard, /saveAltText|updatePost/, 'Discard writes the post');
  assert.match(page, /\{!p\.alt_texts\?\.\[i\] && p\.alt_proposals\?\.\[i\] && \(/, 'the proposal is not drawn beside its image');
  const api = read('lib/api.js');
  assert.match(api, /saveAltText: \(id, index, alt_text, proposal_uid\) =>\s*request\(`\/admin\/x\/posts\/\$\{id\}\/alt-text`, \{\s*method: 'PUT'/);
});

test('part 3, Approve sends only the alt-text captions still offered by the composer', () => {
  const page = read('pages/admin/AdminX.jsx');
  const approve = page.slice(page.indexOf('const approve = async'), page.indexOf('const remove = async'));
  assert.match(approve, /const post = posts\.find\(\(p\) => p\.id === id\);/);
  assert.match(approve, /Object\.entries\(post\?\.alt_proposals \|\| \{\}\)/);
  assert.match(approve, /\.filter\(\(\[index\]\) => !post\.alt_texts\?\.\[index\]\)/);
  assert.match(approve, /\.map\(\(\[, proposal\]\) => proposal\.uid\)/);
  assert.match(approve, /await api\.approvePost\(id, uids\);/);
  const client = read('lib/api.js');
  assert.match(client, /JSON\.stringify\(altTextProposalUids\.length \? \{ alt_text_proposal_uids: altTextProposalUids \} : \{\}\)/);
});
