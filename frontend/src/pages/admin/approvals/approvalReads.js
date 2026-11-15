// D5881 — cancel obsolete reads and debounce Inbox search.
export function startApprovalRead(read, onReply, onError) {
  const controller = new AbortController();
  const { signal } = controller;
  Promise.resolve().then(() => {
    if (!signal.aborted) return read(signal);
  }).then(
    (reply) => { if (!signal.aborted) onReply(reply); },
    (error) => { if (!signal.aborted && error?.name !== 'AbortError') onError(error); },
  );
  return () => controller.abort();
}

export function debounceApprovalSearch(commit) {
  let timer;
  const cancel = () => clearTimeout(timer);
  return {
    cancel,
    schedule(value) {
      cancel();
      timer = setTimeout(() => commit(value), 300);
    },
  };
}
