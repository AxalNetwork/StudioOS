/**
 * #4572 follow-up — a fully qualified name may end in the DNS root's dot
 * (`localhost.`, `axal.vc.`). The two guards that check a name and then
 * resolve it (`customUrlRefusal` for a member's MCP server, `imageUrlRefusal`
 * for an outside image) compare names without that dot, so a trailing dot no
 * longer slips past the private-name and own-host rules. The DNS check after
 * them was unchanged and already refused private addresses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { customUrlRefusal } from '../src/integrations/customMcp.ts';
import { imageUrlRefusal } from '../src/services/decks/imageSafety.ts';

test('the MCP URL guard: a trailing root dot is the same name for the private and own-host rules', () => {
  // Mutation checked: the trailing-dot strip removed from customUrlRefusal.
  for (const [url, why] of [
    ['https://localhost./mcp', 'private_name'],
    ['https://localhost../mcp', 'private_name'],
    ['https://metadata.google.internal./v1', 'private_name'],
    ['https://printer.local./mcp', 'private_name'],
    ['https://router.home.arpa./mcp', 'private_name'],
    ['https://intranet./mcp', 'private_name'],
    ['https://axal.vc./api/mcp', 'axal_host'],
    ['https://app.axal.vc./api/mcp', 'axal_host'],
    ['https://127.0.0.1./mcp', 'ip_literal'],
    ['https://./mcp', 'bad_url'],
    ['https://.../mcp', 'bad_url'],
  ] as const) {
    assert.equal(customUrlRefusal(url), why, url);
  }
  assert.equal(customUrlRefusal('https://mcp.synthetic.example./mcp', 'mcp.synthetic.example'), 'axal_host', 'the request\'s own host, with the dot');
  assert.equal(customUrlRefusal('https://mcp.synthetic.example/mcp', 'mcp.synthetic.example.:443'), 'axal_host', 'its own host given with a dot and a port');
  assert.equal(customUrlRefusal('https://mcp.example.com./mcp'), null, 'a public name with its root dot is still a public name');
});

test('the outside-image guard drops the root dot the same way', () => {
  // Mutation checked: the trailing-dot strip removed from imageUrlRefusal.
  for (const url of ['https://localhost./a.png', 'https://cdn.internal./a.png', 'https://box.lan./a.png', 'https://intranet./a.png']) {
    assert.equal(imageUrlRefusal(url), 'private_name', url);
  }
  assert.equal(imageUrlRefusal('https://./a.png'), 'bad_url');
  assert.equal(imageUrlRefusal('https://img.example.test./a.png'), null);
});
