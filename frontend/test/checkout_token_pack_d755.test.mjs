/**
 * D755 CR7 (#1985): isolated pack checkout and a receipt that only reads.
 * Provider calls are stubs. Every mutant runs the same scenario again after
 * restoration. Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/checkout_token_pack_d755.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { installDocument } from './_contracts_dom.mjs';

const CHECKOUT = '../src/pages/CheckoutPage.jsx';
const RECEIPT = '../src/pages/CheckoutConfirmationPage.jsx';
const PACKS = '../src/components/products/TokenPacksSection.jsx';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const originalSources = { [CHECKOUT]: read(CHECKOUT), [RECEIPT]: read(RECEIPT), [PACKS]: read(PACKS) };
let activeSources = originalSources, moduleId = 0;
const h = React.createElement;
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const reactUrl = import.meta.resolve('react');
const proxies = dataModule(
  'export const api = new Proxy({}, {get(_t,k){return globalThis.__d755Checkout.api[k]}});' +
  'export const publicPricingApi={plansAndPacks(){return globalThis.__d755Checkout.publicPacks()}};' +
  'export const aiBudgetApi = {topUp(){return globalThis.__d755Checkout.topUp()}};' +
  'export function useAuth(){return {user:globalThis.__d755Checkout.visitor ? null : {id:2,email:"member@example.test",name:"Fixture Member"}}}' +
  'export function useSettings(){return {effectiveTheme:"light"}}' +
  'export function getStripe(){return Promise.resolve(globalThis.__d755Checkout.stripe)}' +
  'export function buildAppearance(){return {}}' +
  'export function useCart(){globalThis.__d755Checkout.cartMounts++;return globalThis.__d755Checkout.cart}'
);
const stripeModule = dataModule(
  'import React from ' + JSON.stringify(reactUrl) + ';' +
  'export const Elements=({children})=>React.createElement(React.Fragment,null,children);' +
  'export const useStripe=()=>globalThis.__d755Checkout.stripe;' +
  'export const useElements=()=>globalThis.__d755Checkout.elements;' +
  'export function PaymentElement({onReady}){React.useEffect(()=>{onReady()},[onReady]);return React.createElement("div",null,"Fixture card element")}' +
  'export const AddressElement=({onChange})=>React.createElement("button",{type:"button",onClick:()=>onChange({value:{address:{country:"AE"}}})},"Use UAE billing address");'
);
const mockedImports = {
  '../../lib/api/publicPricing': proxies, '../../hooks/useAuthSync': proxies,
  '../lib/api': proxies, '../lib/api/aiBudget': proxies, '../hooks/useAuthSync': proxies,
  '../contexts/SettingsContext': proxies, '../lib/stripe': proxies,
  '../components/products/useCart': proxies, '@stripe/react-stripe-js': stripeModule,
};
async function loadPage(path) {
  const file = new URL(path, import.meta.url);
  const { code } = await transformWithOxc(activeSources[path], file.pathname, { jsx: { runtime: 'automatic' } });
  const source = code.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => {
      let target = mockedImports[spec];
      if (!target && spec.startsWith('.')) {
        const full = new URL(spec, file);
        target = [full.href, ...['.js', '.jsx', '.mjs'].map(ext => full.href + ext)].find(url => existsSync(new URL(url)));
        assert.ok(target, 'relative import exists: ' + spec);
      }
      return prefix + (target || import.meta.resolve(spec)) + quote;
    });
  return import(dataModule(source + '\n// fixture module ' + ++moduleId));
}
const PACK = { uid: 'pack25', label: '$25 of tokens', price_id: 'price_Pack25', unit_amount: 2500, currency: 'usd', credit_microusd: 25_000_000, bonus_microusd: 0 };
const OTHER_PACK = { ...PACK, uid: 'pack50', price_id: 'price_Pack50', unit_amount: 5000 };
const READY = { configured: false, state: 'ready', packs: [OTHER_PACK, PACK], on_hold: false, latest: null };
const ITEM = { price_id: 'price_Existing', name: 'Existing item', quantity: 3, unit_amount: 900, currency: 'usd' };
const ORDER = { order_ref: 'MRD-2026-FIXTURE', status: 'paid', subtotal: 2500, total: 2625, currency: 'usd',
  vat_cents: 125, discount_cents: 0, items: [{ ...PACK, name: '$25 of tokens', quantity: 1, line_total: 2500 }],
  paid_at: '2026-10-19T00:00:00Z', created_at: '2026-10-19T00:00:00Z' };
const purchase = state => ({ ...ORDER, ai_topup: { state, amount_microusd: 25_000_000, credit_microusd: 25_000_000,
  balance_microusd: 54_000_000, at: new Date().toISOString() } });
const textOf = n => !n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '';
const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
async function settle() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }

async function withWorld(check, options = {}) {
  const restoreDom = installDocument();
  // React updates text nodes through nodeValue and replaces element contents
  // through textContent. Match those DOM operations so old receipt text cannot
  // survive a state transition in the small shared document fixture.
  const createText = document.createTextNode.bind(document);
  document.createTextNode = value => {
    const node = createText(value);
    Object.defineProperty(node, 'nodeValue', { get: () => node.textContent, set: value => { node.textContent = String(value); } });
    return node;
  };
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const node = createElement(tag);
    Object.defineProperty(node, 'textContent', {
      get: () => node.childNodes.map(child => child.textContent || '').join(''),
      set: value => {
        for (const child of node.childNodes) child.parentNode = null;
        node.childNodes = [];
        if (String(value)) node.appendChild(document.createTextNode(String(value)));
      },
    });
    return node;
  };
  const previous = { fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    fixture: globalThis.__d755Checkout };
  const timers = [], delays = [], requests = [], writes = [], cartCalls = [], unexpected = [], storage = new Map([
    ['axal_cart_v1', JSON.stringify([ITEM])], ['axal_cart_promo_v1', JSON.stringify({ code: 'EXISTINGPROMO', discount_cents: 100 })],
  ]);
  const initialStorage = [...storage];
  globalThis.sessionStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem: k => storage.delete(k) };
  globalThis.fetch = async (...args) => { unexpected.push(String(args[0])); throw new Error('Unexpected provider call'); };
  const cart = { items: [ITEM], subtotal: 2700, currency: 'usd', promo: { code: 'EXISTINGPROMO', discount_cents: 100 } };
  for (const key of ['add', 'clear', 'remove', 'changeQty', 'setPromo']) cart[key] = (...args) => cartCalls.push([key, ...args]);
  const w = {
    timers, delays, requests, writes, cartCalls, storage, initialStorage, cart, cartMounts: 0, path: '',
    visitor: !!options.visitor,
    publicPacks: async () => options.publicPacks ? options.publicPacks() : ({packs:[PACK,{...OTHER_PACK,uid:null}]}),
    topUp: async () => options.topUpError ? Promise.reject(new Error('fixture read failed')) : options.reading ?? READY,
    stripe: { confirmPayment: async body => {
      w.paymentArgs = body;
      return options.paymentError ? { error: { message: options.paymentError } }
        : { paymentIntent: { id: 'pi_Fixture', status: options.paymentStatus ?? 'succeeded' } };
    } },
    elements: { submit: async () => ({}) },
    api: {
      createOrderIntent: async body => {
        requests.push(body); writes.push('intent');
        if (options.refusal) throw new Error(options.refusal);
        return { order_ref: ORDER.order_ref, client_secret: 'pi_fixture_secret', free: false };
      },
      confirmOrder: async () => { writes.push('confirm'); return {}; },
      getOrder: async ref => {
        w.readCount++;
        if (options.load) return options.load(ref, w.readCount);
        return { order: options.order ?? purchase('waiting') };
      },
      orderInvoiceBlob: async () => { throw new Error('not requested'); },
    },
    readCount: 0,
  };
  globalThis.__d755Checkout = w;
  let root = null, container = null;
  const schedule = (fn, delay) => { const entry = { fn, delay }; timers.push(entry); delays.push(delay); return entry; };
  const cancel = entry => { const at = timers.indexOf(entry); if (at >= 0) timers.splice(at,1); };
  w.schedule = schedule; w.cancel = cancel;
  w.tick = async () => {
    const next = timers.shift(); assert.ok(next, 'a waiting receipt schedules another read');
    await act(async () => { await next.fn(); }); await settle();
  };
  w.mount = async (path, url) => {
    const page = await loadPage(path);
    if (path === RECEIPT) { globalThis.setTimeout = schedule; globalThis.clearTimeout = cancel; }
    const Probe = () => { const location = useLocation(); w.path = location.pathname + location.search + location.hash; return null; };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(React.Fragment, null, h(Routes, null, h(Route, { path: path === CHECKOUT ? '/checkout' : path === PACKS ? '/plans-and-pricing' : '/checkout/confirmation', element: h(page.default) }), h(Route, { path: '*', element: null })), h(Probe)))));
    await settle();
    return page;
  };
  w.nodes = () => walk(container);
  w.text = () => textOf(container).replace(/\s+/g,' ').trim();
  w.click = async label => {
    const node = w.nodes().find(n => n.tagName === 'BUTTON' && textOf(n).trim() === label);
    assert.ok(node, 'button exists: ' + label); assert.equal(!!props(node).disabled, false);
    await act(async () => { await props(node).onClick({ preventDefault() {} }); }); await settle();
  };
  w.pay = async () => {
    const form = w.nodes().find(n => n.tagName === 'FORM'); assert.ok(form, 'payment form exists');
    await act(async () => { await props(form).onSubmit({ preventDefault() {} }); }); await settle();
  };
  w.unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; } };
  try { await check(w); }
  finally {
    await w.unmount();
    globalThis.fetch = previous.fetch; globalThis.sessionStorage = previous.sessionStorage;
    globalThis.setTimeout = previous.setTimeout; globalThis.clearTimeout = previous.clearTimeout;
    if (previous.fixture === undefined) delete globalThis.__d755Checkout; else globalThis.__d755Checkout = previous.fixture;
    restoreDom();
    assert.deepEqual(unexpected, [], 'no real provider is contacted');
  }
}
async function packCheckout() {
  await withWorld(async w => {
    await w.mount(CHECKOUT, '/checkout?token_pack=pack25');
    assert.match(w.text(), /\$25 of tokens · One-time purchase/);
    assert.match(w.text(), /Adds \$25\.00 to your top-up balance once the payment is confirmed\./);
    assert.match(w.text(), /Sold by Axal VC Management LLC\./);
    assert.match(w.text(), /Back to Plans & Pricing/);
    assert.doesNotMatch(w.text(), /Save this payment method|Remove|EXISTINGPROMO/);
    assert.equal(w.nodes().some(n => props(n).placeholder === 'Promo code'), false);
    assert.equal(w.nodes().some(n => n.tagName === 'BUTTON' && ['+','−'].includes(textOf(n).trim())), false);
    assert.equal(w.cartMounts, 0);
    assert.deepEqual(w.requests[0].items, [{ price_id: PACK.price_id, quantity: 1 }]);
    assert.equal(w.requests[0].promo_code, undefined);
    assert.ok(w.requests[0].nonce);
    await w.click('Use UAE billing address');
    assert.equal(w.requests.at(-1).billing_country, 'AE');
    assert.match(w.text(), /VAT\s*\(\s*5\s*%, est\.\)/);
    assert.deepEqual(w.cartCalls, []);
    assert.deepEqual([...w.storage], w.initialStorage);
  });
}
async function unavailable() {
  for (const reading of [{ state: 'unset', packs: [] }, { state: 'not_ready', packs: [] }, { ...READY, packs: [OTHER_PACK] }]) {
    await withWorld(async w => {
      await w.mount(CHECKOUT, '/checkout?token_pack=pack25');
      assert.match(w.text(), /Top-up isn't available yet\./);
      assert.equal(props(w.nodes().find(n => n.tagName === 'A')).href, '/plans-and-pricing');
      assert.deepEqual(w.requests, []); assert.equal(w.cartMounts,0);
    }, { reading });
  }
}
async function unreadable() {
  for (const options of [{ topUpError: true }, { reading: { state: 'ready', packs: [{ ...PACK, currency: 'eur' }] } }]) {
    await withWorld(async w => {
      await w.mount(CHECKOUT, '/checkout?token_pack=pack25');
      assert.match(w.text(), /The token pack could not be read\. Refresh to retry\./);
      assert.doesNotMatch(w.text(), /Top-up isn't available yet/); assert.deepEqual(w.requests, []);
    }, options);
  }
}
async function refusals() {
  for (const code of ['token_pack_alone', 'token_pack_not_ready', 'token_pack_daily_limit', 'token_packs_on_hold', 'promo_not_for_token_packs', 'token_balance_ceiling']) {
    const refusal = code + ': fixture Worker message';
    await withWorld(async w => {
      await w.mount(CHECKOUT, '/checkout?token_pack=pack25');
      assert.ok(w.text().includes(refusal));
      assert.equal(w.nodes().some(n => n.tagName === 'FORM'), false); assert.deepEqual(w.cartCalls, []);
    }, { refusal });
  }
}
async function paymentFailure() {
  await withWorld(async w => {
    await w.mount(CHECKOUT, '/checkout?token_pack=pack25'); await w.pay();
    assert.match(w.text(), /The payment did not go through, so no tokens were added\. Your card was declined\./);
    assert.equal(w.path, '/checkout?token_pack=pack25');
    assert.deepEqual(w.writes, ['intent']); assert.deepEqual(w.cartCalls, []);
  }, { paymentError: 'Your card was declined.' });
}
async function paymentSuccess() {
  for (const paymentStatus of ['succeeded','processing']) await withWorld(async w => {
    await w.mount(CHECKOUT, '/checkout?token_pack=pack25'); await w.pay();
    assert.ok(w.path.startsWith('/checkout/confirmation?order=' + ORDER.order_ref));
    assert.ok(w.path.endsWith('&token_pack=pack25'));
    assert.equal(w.paymentArgs.confirmParams.setup_future_usage, undefined);
    assert.deepEqual(w.writes, ['intent']); assert.deepEqual(w.cartCalls, []);
    assert.deepEqual([...w.storage], w.initialStorage);
  }, { paymentStatus });
}
async function retiredPath() {
  await withWorld(async w => {
    await w.mount(CHECKOUT, '/checkout?ai_topup=1');
    assert.equal(w.path, '/plans-and-pricing#token-packs');
    assert.equal(w.cartMounts, 0); assert.deepEqual(w.requests, []); assert.deepEqual(w.cartCalls, []);
  });
  assert.equal(existsSync(new URL('../src/hooks/useAiTopupCart.js', import.meta.url)), false, 'obsolete hook is removed');
}
async function ordinaryCheckout() {
  await withWorld(async w => {
    await w.mount(CHECKOUT, '/checkout');
    assert.ok(w.cartMounts > 0);
    assert.deepEqual(w.requests[0].items, [{ price_id: ITEM.price_id, quantity: ITEM.quantity }]);
    assert.equal(w.requests[0].promo_code, 'EXISTINGPROMO');
    assert.equal(w.nodes().some(n => props(n).placeholder === 'Promo code'), true);
    await w.pay(); assert.deepEqual(w.writes, ['intent','confirm']); assert.deepEqual(w.cartCalls, [['clear']]);
  });
}
async function receiptCredit() {
  await withWorld(async w => {
    await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    assert.match(w.text(), /Order received/); assert.doesNotMatch(w.text(), /Tokens added|Order confirmed/);
    assert.match(w.text(), /Adding \$25\.00 to your top-up balance\. This page updates when Stripe confirms the payment\./);
    assert.equal(w.timers.length, 1);
    await w.tick();
    assert.match(w.text(), /Tokens added/); assert.match(w.text(), /New balance: \$54\.00/);
    assert.equal(w.timers.length, 0); assert.equal(w.readCount, 2);
    await w.click('See usage'); assert.equal(w.path, '/account/usage#top-ups');
    assert.deepEqual(w.writes, []);
  }, { load: async (_ref,n) => ({ order: purchase(n === 1 ? 'waiting' : 'credited') }) });
}
async function receiptTerminal() {
  for (const state of ['refunded', 'disputed']) await withWorld(async w => {
    await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    assert.match(w.text(), state === 'refunded' ? /Tokens refunded/ : /Payment disputed/);
    assert.doesNotMatch(w.text(), /Tokens added|New balance/);
    assert.equal(w.timers.length, 0); assert.equal(w.readCount, 1); assert.deepEqual(w.writes, []);
  }, { order: purchase(state) });
}
async function receiptBound() {
  await withWorld(async w => {
    const page = await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    for (let n = 0; n < 10 && w.timers.length; n++) await w.tick();
    assert.equal(w.readCount, page.ORDER_POLL_DELAYS.length + 1);
    assert.equal(w.timers.length, 0);
    assert.deepEqual(w.delays, page.ORDER_POLL_DELAYS);
    assert.ok(w.delays.every((delay,i) => delay > 0 && (!i || delay >= w.delays[i-1])));
    assert.match(w.text(), /The payment is recorded\. Check Usage/);
    assert.doesNotMatch(w.text(), /Tokens added/); assert.deepEqual(w.writes, []);
  });
}
async function cancelledReads() {
  await withWorld(async w => {
    const page = await loadPage(RECEIPT); let resolve, shown = 0, errors = 0, stopped = 0;
    const cancel = page.watchOrder(ORDER.order_ref, {
      tokenPackHint: true, load: () => new Promise(r => { resolve = r; }),
      schedule: w.schedule, cancel: w.cancel, onOrder: () => shown++, onError: () => errors++,
      onNotFound: () => assert.fail('unexpected 404'), onExhausted: () => stopped++,
    });
    cancel(); resolve({ order: purchase('credited') }); await settle();
    assert.deepEqual([shown,errors,stopped,w.timers.length],[0,0,0,0]);
    await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    assert.equal(w.timers.length,1); await w.unmount(); assert.equal(w.timers.length,0);
  });
}
async function ordinaryReceipt() {
  for (const load of [async () => ({order:null}), async () => { throw Object.assign(new Error('Not found'),{status:404}); }]) {
    await withWorld(async w => {
      await w.mount(RECEIPT, '/checkout/confirmation?order=missing');
      assert.equal(w.path, '/plans-and-pricing'); assert.equal(w.timers.length,0); assert.deepEqual(w.writes,[]);
    }, {load});
  }
  await withWorld(async w => {
    await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    assert.match(w.text(), /Order confirmed/); assert.match(w.text(), /Go to Dashboard/);
    assert.equal(w.timers.length,0); assert.deepEqual(w.writes,[]);
  }, {order:ORDER});
}
async function incompleteProjection() {
  await withWorld(async w => {
    await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref);
    assert.match(w.text(), /New balance: Unreadable/); assert.doesNotMatch(w.text(), /New balance: \$0\.00/);
    assert.deepEqual(w.writes,[]);
  }, {load:async()=>{const order=purchase('credited');delete order.ai_topup.balance_microusd;return {order};}});
  await withWorld(async w => {
    const page = await w.mount(RECEIPT, '/checkout/confirmation?order=' + ORDER.order_ref + '&token_pack=pack25');
    assert.doesNotMatch(w.text(), /Tokens added|Order confirmed/);
    for(let n=0;n<10 && w.timers.length;n++)await w.tick();
    assert.equal(w.readCount,page.ORDER_POLL_DELAYS.length+1); assert.equal(w.timers.length,0);
    assert.match(w.text(), /Your order is recorded\. Check Usage/); assert.deepEqual(w.writes,[]);
  }, {order:{...ORDER,status:'pending'}});
}
async function pricingPacks() {
  await withWorld(async w => {
    const page = await w.mount(PACKS, '/plans-and-pricing#token-packs');
    assert.ok(w.nodes().some(n => props(n).id === 'token-packs'));
    const links = w.nodes().filter(n => n.tagName === 'A');
    assert.deepEqual(links.map(n => [textOf(n),props(n).href]),
      [['Buy','/checkout?token_pack=pack25'],['Buy','/checkout?token_pack=price_Pack50']]);
    assert.match(w.text(), /\$25 of tokens/);
    assert.match(w.text(), /\$1 of tokens buys \$1 of AI use\. Tokens never expire\./);
    assert.match(w.text(), /Sold by Axal VC Management LLC\./);
    assert.match(w.text(), /VAT, where it applies, is added at checkout and is not part of the tokens\./);
    assert.equal(w.cartMounts,0); assert.deepEqual(w.cartCalls,[]);
    assert.equal(page.isPackProduct({kind:'token_pack'}),true);
    assert.equal(page.isPackProduct({metadata:{kind:'token_pack'}}),true);
    assert.equal(page.isPackProduct({prices:[{id:PACK.price_id}]},[PACK]),true);
    assert.equal(page.isPackProduct({kind:'alacarte',prices:[{id:'price_Other'}]},[PACK]),false);
  });
  const integration = read('../src/pages/ProductsPage.jsx');
  assert.match(integration, /<TokenPacksSection onPacksRead=\{setTokenPacks\} \/>/);
  assert.match(integration, /!isBundleProduct\(p\) && !isPackProduct\(p, tokenPacks\)/);
}
async function pricingReadStates() {
  await withWorld(async w => {
    await w.mount(PACKS, '/plans-and-pricing');
    assert.match(w.text(), /Top-up isn't available yet\./);
    assert.ok(!w.nodes().some(n => n.tagName==='A'));
  },{publicPacks:async()=>({packs:[]})});
  let n=0;
  await withWorld(async w => {
    await w.mount(PACKS, '/plans-and-pricing');
    assert.match(w.text(), /Unreadable/); assert.ok(!w.nodes().some(n=>n.tagName==='A'));
    await w.click('Retry');
    assert.match(w.text(), /\$25 of tokens/);
    assert.ok(w.nodes().some(n=>n.tagName==='A' && props(n).href==='/checkout?token_pack=pack25'));
  },{publicPacks:async()=>{if(n++===0)throw new Error('unavailable');return {packs:[PACK]};}});
  await withWorld(async w => {
    await w.mount(PACKS, '/plans-and-pricing');
    assert.match(w.text(), /Unreadable/); assert.ok(!w.nodes().some(n=>n.tagName==='A'));
  },{publicPacks:async()=>({packs:[{...PACK,currency:'eur'}]})});
}
async function pricingVisitor() {
  await withWorld(async w => {
    await w.mount(PACKS, '/plans-and-pricing');
    const links=w.nodes().filter(n=>n.tagName==='A');
    assert.equal(links.length,2);
    for(const link of links){
      assert.equal(textOf(link),'Sign in to buy');
      assert.equal(new URL(props(link).href,'https://example.test').searchParams.get('next'),'/plans-and-pricing#token-packs');
    }
    assert.equal(w.cartMounts,0);
  },{visitor:true});
}
const scenarios = [pricingPacks, pricingReadStates, pricingVisitor, packCheckout, unavailable, unreadable, refusals, paymentFailure, paymentSuccess, retiredPath,
  ordinaryCheckout, receiptCredit, receiptTerminal, receiptBound, cancelledReads, ordinaryReceipt, incompleteProjection];
for (const check of scenarios) test('D755 CR7: ' + check.name, check);

const mutations = [
  {name:"pack links lose their identifier",file:PACKS,before:"encodeURIComponent(pack.uid || pack.price_id)",after:"encodeURIComponent('wrong_pack')",check:pricingPacks},
  {name:"pack price becomes hardcoded",file:PACKS,before:"packLabel(pack.unit_amount)",after:"'$5 of tokens'",check:pricingPacks},
  {name:"pack price is admitted to the shared cart",file:PACKS,before:"packs.some(pack => pack.price_id === price.id)",after:"false",check:pricingPacks},
  {name:"no packs are called unreadable",file:PACKS,before:"<p>{TOPUP_UNAVAILABLE}</p>",after:"<p>Unreadable</p>",check:pricingReadStates},
  {name:"failed read is called empty",file:PACKS,before:"setReading({ status: 'unreadable', packs: [] });",after:"setReading({ status: 'ready', packs: [] });",check:pricingReadStates},
  {name:"retry never retries",file:PACKS,before:"setAttempt(n => n + 1)",after:"setAttempt(n => n)",check:pricingReadStates},
  {name:"visitor buys without signing in",file:PACKS,before:"href={user ?",after:"href={true ?",check:pricingVisitor},
  {name:"seller disappears",file:PACKS,before:"Sold by Axal VC Management LLC.",after:"",check:pricingPacks},
  {name:"tokens promise disappears",file:PACKS,before:"{TOKENS_LINE}",after:"{'Tokens'}",check:pricingPacks},

  {name:'unreadable pack is called unavailable',file:CHECKOUT,before:'The token pack could not be read. Refresh to retry.',after:"Top-up isn't available yet.",check:unreadable},
  {name:'ordinary promo lost',file:CHECKOUT,before:"if (!pack && appliedPromo?.code)",after:"if (false)",check:ordinaryCheckout},
  {name:'ordinary fulfilment confirmation lost',file:CHECKOUT,before:"if (paymentIntentId && !pack)",after:"if (false)",check:ordinaryCheckout},
  {name:'ordinary receipt becomes a token receipt',file:RECEIPT,before:"order.status === 'paid' ? 'Order confirmed'",after:"order.status === 'paid' ? 'Tokens added'",check:ordinaryReceipt},
  {name:'unmount leaves its poll scheduled',file:RECEIPT,before:"if (timer !== null) cancel(timer);",after:"",check:cancelledReads},
  {name:'back link names the retired page',file:CHECKOUT,before:'Back to Plans &amp; Pricing',after:'Back to Products',all:true,check:packCheckout},
  {name:'a pack is added to the shared cart',file:CHECKOUT,
    before:"  const state = aiTokenState(",after:"  const shared = useCart(); shared.add(PACK_PLACEHOLDER, 1);\n  const state = aiTokenState(",check:packCheckout},
  {name:'wrong pack selected',file:CHECKOUT,before:"reading.data.packs.find(p => p.uid === uid || (p.uid == null && p.price_id === uid))",after:"reading.data.packs[0]",check:packCheckout},
  {name:'ready packs are hidden',file:CHECKOUT,before:"const state = aiTokenState(reading)",after:"const state = 'not_ready'",check:packCheckout},
  {name:'pack quantity can double',file:CHECKOUT,before:"name: packLabel(pack.unit_amount), quantity: 1",after:"name: packLabel(pack.unit_amount), quantity: 2",check:packCheckout},
  {name:'pack has a promo box',file:CHECKOUT,before:"{!pack && <><div",after:"{true && <><div",check:packCheckout},
  {name:'pack has a stepper',file:CHECKOUT,before:'{!pack && <div className="inline-flex items-center border',after:'{true && <div className="inline-flex items-center border',check:packCheckout},
  {name:'pack offers saving a card',file:CHECKOUT,before:'{!pack && <label className="flex items-center',after:'{true && <label className="flex items-center',check:packCheckout},
  {name:'pack carries a stale promo',file:CHECKOUT,before:"    api.createOrderIntent(body)",after:"    if (pack) body.promo_code = 'EXISTINGPROMO';\n    api.createOrderIntent(body)",check:packCheckout},
  {name:'VAT country not sent',file:CHECKOUT,before:"if (billingCountry) body.billing_country = billingCountry;",after:"",check:packCheckout},
  {name:'seller removed',file:CHECKOUT,before:"Sold by Axal VC Management LLC.",after:"",check:packCheckout},
  {name:'unavailable is called unreadable',file:CHECKOUT,before:": TOPUP_UNAVAILABLE}",after:": 'Unreadable'}",check:unavailable},
  {name:'Worker refusal replaced',file:CHECKOUT,before:"setIntentError(e?.message || 'Could not start checkout.')",after:"setIntentError('Could not start checkout.')",check:refusals},
  {name:'failed payment says nothing about tokens',file:CHECKOUT,before:"The payment did not go through, so no tokens were added.",after:"Payment failed.",all:true,check:paymentFailure},
  {name:'pack clears the existing cart',file:CHECKOUT,before:"    if (!pack) cart.clear();",after:"    if (pack) useCart().clear(); else cart.clear();",check:paymentSuccess},
  {name:'pack confirms outside the webhook',file:CHECKOUT,before:"paymentIntentId && !pack",after:"paymentIntentId",check:paymentSuccess},
  {name:'retired URL points to products',file:CHECKOUT,before:'to={TOKEN_PACKS_PATH}',after:'to="/products"',check:retiredPath},
  {name:'waiting is shown as credited',file:RECEIPT,before:"state === 'credited' ? 'Tokens added'",after:"(state === 'credited' || state === 'waiting') ? 'Tokens added'",check:receiptCredit},
  {name:'paid order stops waiting for credit',file:RECEIPT,before:"if (!knownPack || ['credited',",after:"if (!knownPack || value.status === 'paid' || ['credited',",check:receiptCredit},
  {name:'refund keeps polling',file:RECEIPT,before:"['credited', 'refunded', 'disputed'].includes(state)",after:"['credited'].includes(state)",check:receiptTerminal},
  {name:'polling is unbounded',file:RECEIPT,before:"attempts > ORDER_POLL_DELAYS.length",after:"attempts > Infinity",check:receiptBound},
  {name:'retry has no backoff',file:RECEIPT,before:"schedule(read, ORDER_POLL_DELAYS[attempts - 1])",after:"schedule(read, 0)",check:receiptBound},
  {name:'late reply survives cancellation',file:RECEIPT,before:"if (stopped) return;",after:"",all:true,check:cancelledReads},
  {name:'confirmation makes a write',file:RECEIPT,before:"const result = await load(orderRef);",after:"await api.confirmOrder(orderRef);\n      const result = await load(orderRef);",check:receiptCredit},
  {name:'unreadable balance becomes zero',file:RECEIPT,before:"money(topup?.balance_microusd) ?? 'Unreadable'",after:"money(topup?.balance_microusd) ?? '$0.00'",check:incompleteProjection},
  {name:'missing projection stops waiting',file:RECEIPT,before:"knownPack = tokenPackHint",after:"knownPack = false",check:incompleteProjection},
];
for (const m of mutations) test('D755 CR7 mutation: ' + m.name, async () => {
  const source = originalSources[m.file];
  assert.ok(source.includes(m.before), 'mutation target exists: ' + m.name);
  let after = m.after.replace('PACK_PLACEHOLDER', '{price_id:"price_Pack25"}');
  activeSources = {...originalSources,[m.file]:m.all ? source.split(m.before).join(after) : source.replace(m.before,()=>after)};
  try { await assert.rejects(m.check, {name:'AssertionError'}, m.name); }
  finally { activeSources = originalSources; }
  await m.check();
});
