import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePdfDataUri,
  sanitizeText,
  parseLinkedInProfile,
  buildAccountProposal,
  isLinkedInImageHost,
  normalizeProposalForApply,
  LinkedInImportError,
  MAX_PDF_BYTES,
} from '../src/services/linkedinImport.ts';

test('sanitizeText strips control chars and angle brackets', () => {
  assert.ok(!sanitizeText('a\u0000b<script>c').includes('<'));
  assert.ok(!sanitizeText('a\u0000b<script>c').includes('>'));
  assert.equal(sanitizeText('  hi\tthere  '), 'hi there');
  assert.equal(sanitizeText('x'.repeat(600)).length, 500);
});

test('decodePdfDataUri rejects non-PDF MIME', () => {
  assert.throws(
    () => decodePdfDataUri('data:image/png;base64,iVBORw0KGgo='),
    (e: unknown) => e instanceof LinkedInImportError && e.code === 'not_pdf',
  );
});

test('decodePdfDataUri rejects a PDF-MIME file without %PDF- magic bytes', () => {
  // MIME says PDF but bytes are "hello" — spoofed content-type.
  const b64 = Buffer.from('hello world not a pdf').toString('base64');
  assert.throws(
    () => decodePdfDataUri(`data:application/pdf;base64,${b64}`),
    (e: unknown) => e instanceof LinkedInImportError && e.code === 'not_pdf',
  );
});

test('decodePdfDataUri accepts genuine %PDF- bytes', () => {
  const b64 = Buffer.from('%PDF-1.4\n...').toString('base64');
  const { bytes } = decodePdfDataUri(`data:application/pdf;base64,${b64}`);
  assert.ok(bytes[0] === 0x25 && bytes[1] === 0x50);
});

test('decodePdfDataUri enforces the size cap', () => {
  // A base64 string whose implied byte length exceeds the cap.
  const huge = 'A'.repeat(Math.ceil((MAX_PDF_BYTES + 1024) * 4 / 3));
  assert.throws(
    () => decodePdfDataUri(`data:application/pdf;base64,${huge}`),
    (e: unknown) => e instanceof LinkedInImportError && e.code === 'too_large',
  );
});

test('parseLinkedInProfile maps header, about, experience, education, certs', () => {
  const lines = [
    'Ada Lovelace',
    'Founder & CEO at Analytical Engines',
    'London, United Kingdom',
    'About',
    'Building computing machines.',
    'Passionate about algorithms.',
    'Experience',
    'Chief Executive Officer',
    'Analytical Engines · Full-time',
    'Jan 2020 - Present · 5 yrs',
    'London, United Kingdom',
    'Leading the company.',
    'Software Engineer',
    'Babbage Corp · Full-time',
    'Jun 2015 - Dec 2019 · 4 yrs',
    'Wrote a lot of code.',
    'Education',
    'University of London',
    'BSc, Mathematics',
    '2011 - 2015',
    'Licenses & Certifications',
    'Certified Scrum Master',
    'Scrum Alliance',
    'Issued Jan 2019',
    'Skills',
    'Leadership',
  ];
  const p = parseLinkedInProfile(lines);
  assert.equal(p.source, 'pdf');
  assert.equal(p.fields.display_name, 'Ada Lovelace');
  assert.equal(p.fields.headline, 'Founder & CEO at Analytical Engines');
  assert.equal(p.fields.location, 'London, United Kingdom');
  assert.match(p.fields.bio || '', /Building computing machines/);
  assert.ok(p.experience.length >= 2);
  assert.equal(p.experience[0].company, 'Analytical Engines');
  assert.equal(p.experience[0].title, 'Chief Executive Officer');
  assert.equal(p.experience[0].start, 'Jan 2020');
  assert.equal(p.experience[0].end, 'Present');
  assert.ok(p.education.length >= 1);
  assert.equal(p.education[0].school, 'University of London');
  assert.equal(p.education[0].degree, 'BSc');
  assert.equal(p.education[0].field, 'Mathematics');
  assert.ok(p.certifications.length >= 1);
  assert.equal(p.certifications[0].name, 'Certified Scrum Master');
  assert.equal(p.certifications[0].issuer, 'Scrum Alliance');
});

test('parseLinkedInProfile warns on empty/image-only input', () => {
  const p = parseLinkedInProfile([]);
  assert.ok(p.warnings.length > 0);
  assert.equal(p.experience.length, 0);
});

test('buildAccountProposal requires a connected identity', () => {
  assert.throws(
    () => buildAccountProposal(null),
    (e: unknown) => e instanceof LinkedInImportError && e.code === 'not_connected',
  );
});

test('buildAccountProposal maps name + licdn photo, drops non-licdn photo', () => {
  const p = buildAccountProposal({
    linkedin_sub: 'abc',
    linkedin_name: 'Ada Lovelace',
    linkedin_picture_url: 'https://media.licdn.com/dms/image/x.jpg',
  });
  assert.equal(p.fields.display_name, 'Ada Lovelace');
  assert.equal(p.photo_url, 'https://media.licdn.com/dms/image/x.jpg');

  const p2 = buildAccountProposal({
    linkedin_sub: 'abc',
    linkedin_name: 'Ada',
    linkedin_picture_url: 'https://evil.example.com/x.jpg',
  });
  assert.equal(p2.photo_url, null);
});

test('isLinkedInImageHost allows licdn https only', () => {
  assert.ok(isLinkedInImageHost('https://media.licdn.com/x.jpg'));
  assert.ok(!isLinkedInImageHost('http://media.licdn.com/x.jpg'));
  assert.ok(!isLinkedInImageHost('https://evil.com/x.jpg'));
  assert.ok(!isLinkedInImageHost('not a url'));
});

test('normalizeProposalForApply whitelists + clamps client input', () => {
  const out = normalizeProposalForApply({
    fields: { headline: 'H', bio: 'B', location: 'NYC', website: 'https://x.io', junk: 'x' },
    experience: [{ title: 'T', company: 'C', evil: 'drop' }, { nothing: 1 }],
    education: [{ school: 'S' }],
    certifications: [{ name: 'N', issuer: 'I' }],
    photo_url: 'https://media.licdn.com/x.jpg',
    extra: 'ignored',
  });
  assert.equal(out.fields.headline, 'H');
  assert.equal((out.fields as Record<string, unknown>).junk, undefined);
  assert.equal(out.experience.length, 1);
  assert.equal((out.experience[0] as Record<string, unknown>).evil, undefined);
  assert.equal(out.education.length, 1);
  assert.equal(out.certifications.length, 1);
  assert.equal(out.photo_url, 'https://media.licdn.com/x.jpg');
});
