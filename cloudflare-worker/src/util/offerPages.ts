/** Bounded, stable-offset pages. Read one extra row to report whether more exist. */
export function offerPage(raw: string | undefined, size = 200) {
  const page = raw === undefined ? 1 : Number(raw);
  if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / size)) return null;
  return { page, size, offset: (page - 1) * size, limit: size + 1 };
}

export function offerPageResult<T>(rows: T[], paging: NonNullable<ReturnType<typeof offerPage>>) {
  return {
    items: rows.slice(0, paging.size),
    page: paging.page,
    page_size: paging.size,
    has_more: rows.length > paging.size,
  };
}
