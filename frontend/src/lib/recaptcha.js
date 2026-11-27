// D1445: the project's invisible v2 check. Tokens never leave the send request.
const LOAD_ERROR = 'The security check could not load. Reload the page and try again.';
let loading;
const widgets = new WeakMap();

export function loadRecaptcha() {
  if (globalThis.grecaptcha?.render && globalThis.grecaptcha?.execute) return Promise.resolve(globalThis.grecaptcha);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let timer;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(new Error(LOAD_ERROR));
    };
    const ready = () => {
      const api = globalThis.grecaptcha;
      if (!api?.render || !api?.execute) { fail(); return; }
      clearTimeout(timer);
      resolve(api);
    };
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => globalThis.grecaptcha?.ready ? globalThis.grecaptcha.ready(ready) : ready();
    script.onerror = fail;
    timer = setTimeout(fail, 15_000);
    document.head.appendChild(script);
  });
  return loading;
}

export async function invisibleToken(container, siteKey, signal) {
  const api = await loadRecaptcha();
  if (signal?.aborted) throw new Error('Security check cancelled.');
  if (!container || !siteKey) throw new Error(LOAD_ERROR);
  let widget = widgets.get(container);
  if (!widget) {
    widget = { pending: null, id: null };
    const finish = (error, token) => {
      const pending = widget.pending;
      if (!pending) return;
      widget.pending = null;
      clearTimeout(pending.timer);
      pending.cleanup();
      try { api.reset(widget.id); } catch { /* retain the original result */ }
      if (error) pending.reject(new Error(error));
      else if (typeof token === 'string' && token) pending.resolve(token);
      else pending.reject(new Error('Complete the security check and try again.'));
    };
    widget.finish = finish;
    try {
      widget.id = api.render(container, {
        sitekey: siteKey, size: 'invisible',
        callback: token => finish(null, token),
        'expired-callback': () => finish('The security check expired. Try again.'),
        'error-callback': () => finish(LOAD_ERROR),
      });
    } catch { throw new Error(LOAD_ERROR); }
    widgets.set(container, widget);
  }
  if (widget.pending) throw new Error('A security check is already in progress.');
  return new Promise((resolve, reject) => {
    const abort = () => widget.finish('Security check cancelled.');
    widget.pending = { resolve, reject, timer: setTimeout(() => widget.finish('The security check expired. Try again.'), 120_000), cleanup: () => signal?.removeEventListener('abort', abort) };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { api.execute(widget.id); } catch { widget.finish(LOAD_ERROR); }
  });
}
