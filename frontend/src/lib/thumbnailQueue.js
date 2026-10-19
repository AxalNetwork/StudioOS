// D717 (#1851) decision 5 — the Templates tab draws a hundred page-1 thumbnails,
// and each one is a Browser Run page render on the Worker. This keeps at most
// `limit` of them in flight; the rest wait in the order they were asked for.
//
// Pure: `load` is the caller's, and a key cancelled before it starts never
// starts (its promise never settles, because nothing is waiting on it).

export function createThumbnailQueue(limit = 4) {
  const waiting = [];
  let running = 0;
  const pump = () => {
    while (running < limit && waiting.length) {
      const job = waiting.shift();
      running += 1;
      Promise.resolve().then(job.load).then(job.resolve, job.reject).finally(() => { running -= 1; pump(); });
    }
  };
  return {
    enqueue(key, load) {
      return new Promise((resolve, reject) => {
        waiting.push({ key, load, resolve, reject });
        pump();
      });
    },
    cancel(key) {
      for (let i = waiting.length - 1; i >= 0; i -= 1) if (waiting[i].key === key) waiting.splice(i, 1);
    },
  };
}
