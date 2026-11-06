/**
 * Return the editable kind/party pair for a stored template.
 *
 * Older rows can hold a party that no longer fits their selected kind (for
 * example `policy` + `management`). The editor's segmented control hides that
 * impossible choice, so retaining it in state would make the control and live
 * preview disagree. Returning the party to the slug keeps the draft valid.
 * The original template object is not mutated; Save draft persists the repair.
 */
export function editorStoredFormat(template) {
  const options = template?.format_options;
  const kind = template?.doc_kind ?? null;
  const party = template?.axal_party ?? null;
  if (!options || party == null) return { kind, party };
  const effectiveKind = kind ?? options.derived?.kind ?? template?.kind ?? null;
  const partyless = options.partyless_kinds?.includes(effectiveKind);
  const mismatch = partyless ? party !== 'none' : party === 'none';
  return { kind, party: mismatch ? null : party };
}
