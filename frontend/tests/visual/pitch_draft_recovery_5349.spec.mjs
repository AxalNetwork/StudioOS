import { test, expect } from '@playwright/test';
import { keyOf } from '../../src/pages/raise/pitch/deckAutosave.js';
import { prepare } from './_editor.mjs';

const first = 'draft-one';
const second = 'draft-two';

function hasDeviceDraft(key) {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open('studioos-deck-drafts');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const read = db.transaction('drafts').objectStore('drafts').get(key);
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(Boolean(read.result)); };
    };
  });
}

for (const width of [1440, 390]) {
  test.describe(`draft recovery at ${width}px`, () => {
    const phone = width === 390;
    async function notes(page) {
      const field = page.getByTestId(phone ? 'pitch-editor-phone-notes' : 'pitch-editor-notes');
      if (!phone && !(await field.isVisible())) await page.getByTestId('pitch-editor-block-b1').click();
      return field;
    }
    const names = (page) => phone
      ? page.getByTestId('pitch-editor-phone').locator('ol > li > button:first-child')
      : page.getByTestId(/^pitch-editor-rail-\d+$/);
    const expectNames = (page, titles) => expect(names(page)).toHaveText(titles.map((title) => new RegExp(title)));
    const urlOf = ({ projectId }) => `/raise/pitch/edit?project_id=${projectId}`;
    const draftOf = ({ deckId }) => `/api/decks/${deckId}/draft`;

    async function choose(page, action) {
      await page.getByTestId('deck-more-open').click();
      await page.getByTestId(`deck-more-${action}`).click();
    }

    async function open(page, fixture, navigate = () => page.goto(urlOf(fixture))) {
      const loaded = page.waitForResponse((res) => new URL(res.url()).pathname === draftOf(fixture) && res.request().method() === 'GET');
      await navigate();
      const response = await loaded;
      expect(response.ok()).toBe(true);
      await expect(page.getByTestId(phone ? 'pitch-editor-phone' : 'pitch-editor-body')).toBeVisible();
      return response.json();
    }

    async function start(page, request) {
      const { draftRecovery, token } = await prepare(page, request);
      const headers = { Authorization: `Bearer ${token}` };
      expect((await request.delete(draftOf(draftRecovery), { headers })).ok()).toBe(true);
      await page.setViewportSize({ width, height: phone ? 844 : 900 });
      await open(page, draftRecovery);
      return draftRecovery;
    }

    async function saveDoc(page, fixture, edit) {
      const saved = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/decks/${fixture.deckId}/draft-doc`
        && res.request().method() === 'PUT' && res.ok());
      await edit();
      const { doc } = await (await saved).json();
      // Wait for the editor to acknowledge the server write and remove its device
      // copy. Otherwise the next reload could silently pass using IndexedDB.
      await expect.poll(() => page.evaluate(hasDeviceDraft, keyOf(fixture.deckId))).toBe(false);
      return doc;
    }

    async function restore(page) {
      await expect(page.getByTestId('pitch-restore')).toBeVisible();
      await page.getByTestId('pitch-restore-run').click();
      await expect(page.getByTestId('pitch-restore')).toHaveCount(0);
    }

    async function changeDesign(page, { theme, audience }) {
      await choose(page, 'theme');
      if (theme) await page.getByTestId(`pitch-theme-${theme}`).check();
      if (audience) await page.getByTestId('pitch-editor-audience-select').selectOption(audience);
      await page.getByTestId('pitch-sheet-theme').getByRole('button', { name: 'Close', exact: true }).click();
    }

    async function expectDesign(page, theme, audience) {
      await choose(page, 'theme');
      await expect(page.getByTestId(`pitch-theme-${theme}`)).toBeChecked();
      await expect(page.getByTestId('pitch-editor-audience-select')).toHaveValue(audience);
      await page.getByTestId('pitch-sheet-theme').getByRole('button', { name: 'Close', exact: true }).click();
    }

    test('theme-only and audience-only autosaves survive separate reloads', async ({ page, request }) => {
      const fixture = await start(page, request);
      expect(await saveDoc(page, fixture, () => changeDesign(page, { theme: 'neutral_dark' })))
        .toMatchObject({ order: [first, second], theme: { kind: 'neutral_dark' }, audience: null });
      await open(page, fixture, () => page.reload());
      await restore(page);
      await expectDesign(page, 'neutral_dark', '');
      expect(await saveDoc(page, fixture, () => changeDesign(page, { audience: 'angel' })))
        .toMatchObject({ order: [first, second], theme: { kind: 'neutral_dark' }, audience: 'angel' });
      await open(page, fixture, () => page.reload());
      await restore(page);
      await expectDesign(page, 'neutral_dark', 'angel');
    });

    test('removal and removal of the final card survive reload', async ({ page, request }) => {
      const fixture = await start(page, request);
      const remove = async () => {
        await choose(page, 'remove_card');
        await page.getByTestId('pitch-editor-remove-card-confirm').click();
      };
      expect((await saveDoc(page, fixture, remove)).order).toEqual([second]);
      await open(page, fixture, () => page.reload());
      await restore(page);
      await expectNames(page, ['Synthetic second card']);
      expect((await saveDoc(page, fixture, remove)).order).toEqual([]);
      await open(page, fixture, () => page.reload());
      await restore(page);
      await expect(names(page)).toHaveCount(0);
      await expect(page.getByText('This version has no cards yet.')).toBeVisible();
    });

    test('undo clears an already autosaved duplicate', async ({ page, request }) => {
      const fixture = await start(page, request);
      const { order } = await saveDoc(page, fixture, () => choose(page, 'duplicate'));
      expect(order).toEqual([first, expect.any(String), second]);
      expect(order[1]).not.toBe(first);
      await expect(names(page)).toHaveCount(3);
      expect((await saveDoc(page, fixture, () => choose(page, 'undo'))).order).toEqual([first, second]);
      const reopened = await open(page, fixture, () => page.reload());
      expect(reopened.doc.order).toEqual([first, second]);
      expect(reopened.cards.map(({ uid }) => uid)).not.toContain(order[1]);
      await page.waitForLoadState('networkidle');
      if (await page.getByTestId('pitch-restore').isVisible()) await restore(page);
      await expectNames(page, ['Synthetic first card', 'Synthetic second card']);
    });

    for (const keep of [true, false]) {
      test(`offline changes can be ${keep ? 'restored' : 'discarded'} after closing the tab`, async ({ page, request, context }) => {
        const fixture = await start(page, request);
        // Simulate a write-side outage while the shell and its synthetic reads remain available.
        await page.route(`**/api/decks/${fixture.deckId}/**`, (route) =>
          ['PATCH', 'PUT'].includes(route.request().method()) ? route.abort('internetdisconnected') : route.fallback());
        await (await notes(page)).fill('Synthetic offline notes');
        if (phone) await page.getByRole('button', { name: 'Move card 1 down' }).click();
        else await names(page).first().press('Alt+ArrowDown');
        await expectNames(page, ['Synthetic second card', 'Synthetic first card']);
        await changeDesign(page, { theme: 'neutral_dark', audience: 'angel' });
        await expect(page.getByTestId('pitch-sync-offline')).toContainText('saved on this device');
        await expect(page.getByTestId('pitch-sync-offline')).not.toContainText('NOT saved');
        await page.close();

        const reopened = await context.newPage();
        await prepare(reopened, request);
        await reopened.setViewportSize({ width, height: phone ? 844 : 900 });
        await open(reopened, fixture);
        if (keep) {
          await restore(reopened);
          await expectNames(reopened, ['Synthetic second card', 'Synthetic first card']);
          await names(reopened).nth(1).click();
          await expect(await notes(reopened)).toHaveValue('Synthetic offline notes');
          await expectDesign(reopened, 'neutral_dark', 'angel');
        } else {
          await expect(reopened.getByTestId('pitch-restore')).toBeVisible();
          await reopened.getByTestId('pitch-restore-discard').click();
          await expect(reopened.getByTestId('pitch-restore')).toHaveCount(0);
          await expectNames(reopened, ['Synthetic first card', 'Synthetic second card']);
          await expect(await notes(reopened)).toHaveValue('');
          await expectDesign(reopened, 'neutral_light', '');
        }
        const saved = reopened.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes(`/api/decks/${fixture.deckId}/cards/`) && res.ok()
          && res.request().postDataJSON().card.notes === 'Synthetic online edit');
        await (await notes(reopened)).fill('Synthetic online edit');
        expect((await (await saved).json()).card.card.notes).toBe('Synthetic online edit');
      });
    }

    test('Copy mine keeps edits made while a stale revision pauses saving', async ({ page, request }) => {
      const fixture = await start(page, request);
      const cardUrl = `/api/decks/${fixture.deckId}/cards/${first}`;
      await page.route(`**${cardUrl}`, async (route) => {
        const body = route.request().postDataJSON();
        const other = await route.fetch({ postData: { ...body, card: { ...body.card, notes: 'Synthetic other tab' } } });
        expect(other.ok()).toBe(true);
        await route.continue();
      }, { times: 1 });
      const conflict = page.waitForResponse((res) => res.url().endsWith(cardUrl) && res.status() === 409);
      await (await notes(page)).fill('Synthetic initial edit');
      await conflict;
      await expect(page.getByRole('alertdialog', { name: 'This card changed elsewhere' })).toBeVisible();
      await expect(page.getByTestId('pitch-sync-conflict')).toContainText('Saving is paused until you choose');
      await (await notes(page)).fill('Synthetic latest edit');
      const { order } = await saveDoc(page, fixture, () => page.getByTestId('pitch-conflict-copy').click());
      expect(order).toEqual([first, expect.any(String), second]);
      expect(order[1]).not.toBe(first);
      await expect(page.getByTestId('pitch-conflict')).toHaveCount(0);
      await names(page).first().click();
      await expect(await notes(page)).toHaveValue('Synthetic other tab');
      await names(page).nth(1).click();
      await expect(await notes(page)).toHaveValue('Synthetic latest edit');
    });

    test('a refused IndexedDB write is reported during an outage', async ({ page, request }) => {
      const fixture = await start(page, request);
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.transaction.db.name === 'studioos-deck-drafts') throw new DOMException('Synthetic storage refusal', 'QuotaExceededError');
          return put.apply(this, args);
        };
      });
      await page.route(`**/api/decks/${fixture.deckId}/cards/**`, (route) => route.abort('internetdisconnected'));
      await (await notes(page)).fill('Synthetic unsaved notes');
      await expect(page.getByTestId('pitch-sync-offline')).toContainText('NOT saved on this device');
    });
  });
}
