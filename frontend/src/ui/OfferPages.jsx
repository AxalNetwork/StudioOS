export default function OfferPages({ result, busy, onPage, label = 'Results' }) {
  if (!result?.page || (result.page === 1 && !result.has_more)) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <button type="button" className="underline disabled:opacity-40" disabled={busy || result.page <= 1} onClick={() => onPage(result.page - 1)}>Previous</button>
      <span aria-live="polite">Page {result.page}{result.total != null && ` · ${result.total} matching`}</span>
      <button type="button" className="underline disabled:opacity-40" disabled={busy || !result.has_more} onClick={() => onPage(result.page + 1)}>Next</button>
    </nav>
  );
}
