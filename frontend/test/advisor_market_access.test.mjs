import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('advisor market route matches the existing API bypass without using a founder shell', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  const route = app.slice(app.indexOf('<Route path="/market-intel"'), app.indexOf('<Route path="/advisory"'));
  assert.match(route, /labRoles\(\['admin', 'partner', 'investor', 'advisor'\]\)/);
  assert.match(route, /effectiveRole === 'advisor' \? <MarketIntelPage \/>/);
  const tier = readFileSync('cloudflare-worker/src/util/marketIntelTier.ts', 'utf8');
  assert.match(tier, /FULL_LENS_BYPASS_ROLES = \['admin', 'partner', 'advisor'\]/);
  const research = readFileSync('frontend/src/workspaces/ResearchWorkspace.jsx', 'utf8');
  assert.match(research, /role === 'advisor' && <Link to="\/market-intel"/);
});
