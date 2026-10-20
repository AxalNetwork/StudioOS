/**
 * D781 (#2106) — a document the whole app can mount in, for the render check
 * in `airail_every_page_d781.test.mjs`.
 *
 * `_contracts_dom.mjs` is enough for a provider or one page; App is not one
 * page. It mounts the shell, the sidebar, portals and every always-on widget,
 * and their effects measure, observe and listen. This document keeps what a
 * render leaves behind (elements, attributes, text) so a test can read it
 * back, and answers every browser API the app calls with an inert value:
 * no layout, no observers firing, no animation frames, no network.
 *
 * `installAppDom()` returns `{ document, restore, timers }`. `timers.clear()`
 * stops every interval and timeout the app started, so a test ends.
 */

const VOID_SELECTORS = () => null;

class Node {
  constructor(document, nodeType, nodeName) {
    this.ownerDocument = document;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
  }

  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() {
    const s = this.parentNode?.childNodes;
    return s ? s[s.indexOf(this) + 1] || null : null;
  }
  get previousSibling() {
    const s = this.parentNode?.childNodes;
    return s ? s[s.indexOf(this) - 1] || null : null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument;
  }

  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.insertBefore(c, ref);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(next, old) {
    this.insertBefore(next, old);
    return this.removeChild(old);
  }
  remove() { this.parentNode?.removeChild(this); }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  getRootNode() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }
  cloneNode() { return this.ownerDocument.createElement(this.nodeName); }

  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    if (this.nodeType === 3 || this.nodeType === 8) { this._text = String(v ?? ''); return; }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v != null && v !== '') this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }
  dispatchEvent() { return true; }
}

class Text extends Node {
  constructor(document, text, nodeType = 3) {
    super(document, nodeType, nodeType === 3 ? '#text' : '#comment');
    this._text = String(text ?? '');
  }
  get nodeValue() { return this._text; }
  set nodeValue(v) { this._text = String(v ?? ''); }
  get data() { return this._text; }
  set data(v) { this._text = String(v ?? ''); }
}

class Element extends Node {
  constructor(document, tag, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(document, 1, String(tag).toUpperCase());
    this.tagName = this.nodeName;
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    const style = {};
    style.setProperty = (k, v) => { style[k] = v; };
    style.removeProperty = (k) => { delete style[k]; };
    style.getPropertyValue = (k) => style[k] ?? '';
    this.style = style;
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? el.getAttribute(`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined : undefined),
      set: (_, k, v) => { el.setAttribute(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v); return true; },
      deleteProperty: (_, k) => { el.removeAttribute(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`); return true; },
    });
    const classes = () => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    this.classList = {
      add: (...c) => el.setAttribute('class', [...new Set([...classes(), ...c])].join(' ')),
      remove: (...c) => el.setAttribute('class', classes().filter((x) => !c.includes(x)).join(' ')),
      contains: (c) => classes().includes(c),
      toggle: (c, force) => {
        const on = force ?? !classes().includes(c);
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
    };
    this.value = '';
    this.checked = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.scrollWidth = 0;
    this.clientHeight = 0;
    this.clientWidth = 0;
    this.offsetHeight = 0;
    this.offsetWidth = 0;
    this.offsetTop = 0;
    this.offsetLeft = 0;
    this.options = [];
  }

  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name).toLowerCase()) ? this.attributes.get(String(name).toLowerCase()) : null; }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
  removeAttributeNS(_ns, name) { this.removeAttribute(name); }
  getAttributeNS(_ns, name) { return this.getAttribute(name); }

  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get innerHTML() { return ''; }
  set innerHTML(v) { this.textContent = ''; if (v) this._html = String(v); }

  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return this; } }; }
  getClientRects() { return []; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() {}
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  select() {}
  setSelectionRange() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  animate() { return { cancel() {}, finish() {}, play() {}, pause() {}, finished: Promise.resolve(), onfinish: null }; }
  getAnimations() { return []; }
  attachShadow() { return this; }
  showModal() { this.setAttribute('open', ''); }
  show() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  showPopover() {}
  hidePopover() {}
  submit() {}
  reset() {}
  checkValidity() { return true; }
  reportValidity() { return true; }
  setCustomValidity() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  getContext() { return null; }
  toDataURL() { return ''; }
  matches() { return false; }
  closest() { return null; }
  querySelector(sel) { return query(this, sel)[0] || null; }
  querySelectorAll(sel) { return query(this, sel); }
  getElementsByTagName(tag) { return query(this, String(tag).toLowerCase()); }
  getElementsByClassName(c) { return query(this, `.${c}`); }
  insertAdjacentElement(_where, el) { return this.appendChild(el); }
  insertAdjacentHTML() {}
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n); }
  prepend(...nodes) { for (const n of nodes.reverse()) this.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, this.firstChild); }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
}

/**
 * The selectors this test needs, and no more: `tag`, `.class`, `#id` and
 * `[attr]` / `[attr="value"]`, one compound at a time. Anything else matches
 * nothing, which an app's own `querySelector` reads as "not there".
 */
function compile(sel) {
  const s = String(sel || '').trim();
  if (!s || /[\s>+~,:]/.test(s.replace(/\[[^\]]*\]/g, ''))) return null;
  const tag = /^[a-zA-Z][\w-]*/.exec(s)?.[0]?.toLowerCase() || null;
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = /#([\w-]+)/.exec(s)?.[1] || null;
  const attrs = [...s.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].map((m) => [m[1].toLowerCase(), m[2]]);
  return (el) => (!tag || el.localName === tag)
    && classes.every((c) => el.classList.contains(c))
    && (!id || el.getAttribute('id') === id)
    && attrs.every(([a, v]) => (v === undefined ? el.hasAttribute(a) : el.getAttribute(a) === v));
}

function query(root, sel) {
  const test = compile(sel);
  if (!test) return [];
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (test(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

class Document extends Node {
  constructor() {
    super(null, 9, '#document');
    this.ownerDocument = null;
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
    this.cookie = '';
    this.visibilityState = 'visible';
    this.hidden = false;
    this.readyState = 'complete';
    this.title = '';
    this.referrer = '';
    this.fonts = { ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} };
  }

  createElement(tag) { const el = new Element(this, tag); el.ownerDocument = this; return el; }
  createElementNS(ns, tag) { const el = new Element(this, tag, ns); el.ownerDocument = this; return el; }
  createTextNode(text) { const t = new Text(this, text); t.ownerDocument = this; return t; }
  createComment(text) { const t = new Text(this, text, 8); t.ownerDocument = this; return t; }
  createDocumentFragment() { const f = new Node(this, 11, '#document-fragment'); f.ownerDocument = this; return f; }
  createEvent() { return { initEvent() {}, initCustomEvent() {} }; }
  createRange() {
    return { setStart() {}, setEnd() {}, selectNodeContents() {}, collapse() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }), getClientRects: () => [], commonAncestorContainer: this.body };
  }
  createTreeWalker() { return { nextNode: () => null, currentNode: null }; }
  getElementById(id) { return query(this, `#${id}`)[0] || null; }
  querySelector(sel) { return query(this, sel)[0] || null; }
  querySelectorAll(sel) { return query(this, sel); }
  getElementsByTagName(tag) { return query(this, String(tag).toLowerCase()); }
  getElementsByClassName(c) { return query(this, `.${c}`); }
  getSelection() { return null; }
  elementFromPoint() { return null; }
  hasFocus() { return true; }
  execCommand() { return false; }
}

/** Every element with `attr`, depth first. */
export function elementsWith(root, attr) {
  return query(root, `[${attr}]`);
}

/** Elements matching one simple compound selector (see `compile`). */
export function select(root, sel) {
  return query(root, sel);
}

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const GLOBALS = [
  'window', 'self', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'HTMLElement', 'Element', 'Node', 'Text', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'HTMLSelectElement', 'HTMLAnchorElement', 'HTMLFormElement', 'HTMLCanvasElement', 'SVGElement', 'DocumentFragment',
  'matchMedia', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'PerformanceObserver', 'scrollTo', 'scrollBy', 'scroll',
  'innerWidth', 'innerHeight', 'outerWidth', 'devicePixelRatio', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'getSelection', 'open', 'alert', 'confirm', 'prompt', 'print',
  'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'visualViewport', 'screen', 'top', 'parent', 'frameElement', 'origin',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'EventSource', 'WebSocket', 'Notification', 'Image', 'Audio',
];

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

/**
 * Install the document and the browser globals. `fetch(url, init)` answers
 * every request; `user` is the signed-in member the app reads from storage.
 */
export function installAppDom({ fetch, url = 'http://localhost/' } = {}) {
  const previous = new Map(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const document = new Document();
  const at = new URL(url);
  const location = {
    href: at.href, origin: at.origin, protocol: at.protocol, host: at.host, hostname: at.hostname, port: at.port,
    pathname: at.pathname, search: at.search, hash: at.hash,
    assign() {}, replace() {}, reload() {}, toString() { return this.href; },
  };
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realClearInterval = globalThis.clearInterval;
  const live = new Set();
  let closed = false;
  const timers = {
    clear() {
      closed = true;
      for (const t of live) { realClearTimeout(t); realClearInterval(t); }
      live.clear();
    },
  };
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true, enumerable: true });
  set('window', globalThis);
  set('self', globalThis);
  set('top', globalThis);
  set('parent', globalThis);
  set('frameElement', null);
  set('origin', at.origin);
  set('document', document);
  set('navigator', { userAgent: 'node', language: 'en-GB', languages: ['en-GB'], onLine: true, platform: 'node', clipboard: { writeText: async () => {}, readText: async () => '' }, sendBeacon: () => true, mediaDevices: undefined, maxTouchPoints: 0 });
  set('location', location);
  set('history', { state: null, length: 1, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {}, scrollRestoration: 'auto' });
  set('localStorage', memoryStorage());
  set('sessionStorage', memoryStorage());
  for (const name of ['HTMLElement', 'Element', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'HTMLFormElement', 'HTMLCanvasElement', 'SVGElement']) set(name, Element);
  set('Node', Node);
  set('Text', Text);
  set('DocumentFragment', Node);
  set('matchMedia', (query) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } }));
  set('getComputedStyle', () => new Proxy({ getPropertyValue: () => '' }, { get: (t, k) => (k in t ? t[k] : '') }));
  set('requestAnimationFrame', () => 0);
  set('cancelAnimationFrame', () => {});
  set('requestIdleCallback', () => 0);
  set('cancelIdleCallback', () => {});
  set('ResizeObserver', Observer);
  set('IntersectionObserver', Observer);
  set('MutationObserver', Observer);
  set('PerformanceObserver', Observer);
  set('scrollTo', () => {});
  set('scrollBy', () => {});
  set('scroll', () => {});
  set('innerWidth', 1440);
  set('innerHeight', 900);
  set('outerWidth', 1440);
  set('devicePixelRatio', 1);
  set('scrollX', 0);
  set('scrollY', 0);
  set('pageXOffset', 0);
  set('pageYOffset', 0);
  set('visualViewport', { width: 1440, height: 900, addEventListener() {}, removeEventListener() {} });
  set('screen', { width: 1440, height: 900, orientation: { type: 'landscape-primary', addEventListener() {}, removeEventListener() {} } });
  set('addEventListener', () => {});
  set('removeEventListener', () => {});
  set('dispatchEvent', () => true);
  set('getSelection', () => null);
  set('open', () => null);
  set('alert', () => {});
  set('confirm', () => false);
  set('prompt', () => null);
  set('print', () => {});
  set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', fetch || (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  set('EventSource', class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} close() {} });
  set('WebSocket', class { constructor() { this.readyState = 3; } addEventListener() {} removeEventListener() {} send() {} close() {} });
  set('Notification', Object.assign(class {}, { permission: 'denied', requestPermission: async () => 'denied' }));
  set('Image', class { constructor() { this.onload = null; } set src(_) {} });
  set('Audio', class { play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} });
  // The app's timeouts run at their own delay until `timers.clear()`: a
  // debounce fires, an inactivity logout does not. Intervals never run, so
  // polling cannot change a page while it is read, nor keep the process alive.
  set('setTimeout', (fn, ms, ...args) => {
    if (closed) return 0;
    const t = realSetTimeout(() => { live.delete(t); fn(...args); }, Number(ms) || 0);
    live.add(t);
    return t;
  });
  set('clearTimeout', (t) => { live.delete(t); realClearTimeout(t); });
  set('setInterval', () => 0);
  set('clearInterval', (t) => { if (t) realClearInterval(t); });
  const restore = () => {
    timers.clear();
    for (const [k, d] of previous) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  };
  return { document, restore, timers, VOID_SELECTORS };
}
