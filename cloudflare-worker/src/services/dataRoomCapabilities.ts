/**
 * D5074 (#5074) — the Data room's capabilities: what the caller may do in a
 * venture's room, computed once here and used by both the room read (so the
 * page draws only the controls it may use) and every founder-side write in
 * `routes/data_room.ts` (so the answer the page is given is the rule the
 * Worker enforces). The page never infers a permission from a role.
 *
 * Who the caller is in the room (D1103, D1102, D1464):
 *   - `owner`     the account that owns the venture: everything;
 *   - `cofounder` an accepted `project_members` co-founder: reads, uploads,
 *                 renames and moves, deletes a folder, downloads, makes a
 *                 version current, exports activity and indexes search, but
 *                 never sets a gate, deletes a file, shares, answers a request,
 *                 sends the NDA or opts a file into decks;
 *   - `support`   an admin after a reasoned, audited support read: nothing;
 *   - `summary`   an admin's plain read, which is the aggregate summary: nothing,
 *                 and `admin_reason_required`, because the room itself opens
 *                 only through the reasoned support read.
 * Anyone else (an advisor member, an investor, another founder) reads no room
 * at all: every founder-side route answers them 404, so no map is ever built.
 *
 * `send_nda` also needs the caller to be the venture's founder account, since
 * they sign as party A (`pairwise_ndas`, D1104); the route still checks the
 * founder row itself before it issues anything.
 */
export type RoomViewer = 'owner' | 'cofounder' | 'support' | 'summary';

export const ROOM_CAPABILITIES = [
  'upload', 'edit', 'delete_folder', 'set_gate', 'delete', 'share', 'answer_requests',
  'send_nda', 'deck_source', 'download', 'make_current', 'export', 'search_index', 'admin_reason_required',
] as const;
export type RoomCapability = typeof ROOM_CAPABILITIES[number];
export type RoomCapabilities = Record<RoomCapability, boolean>;

const MEMBER: readonly RoomCapability[] = ['upload', 'edit', 'delete_folder', 'download', 'make_current', 'export', 'search_index'];
const OWNER: readonly RoomCapability[] = [...MEMBER, 'set_gate', 'delete', 'share', 'answer_requests', 'deck_source'];

/** The whole map for this viewer; every key is present and a boolean. */
export function roomCapabilities(viewer: RoomViewer, user?: { role?: string | null } | null): RoomCapabilities {
  const granted = new Set<RoomCapability>(viewer === 'owner' ? OWNER : viewer === 'cofounder' ? MEMBER : []);
  if (viewer === 'owner' && String(user?.role ?? '').toLowerCase() === 'founder') granted.add('send_nda');
  if (viewer === 'summary') granted.add('admin_reason_required');
  return Object.fromEntries(ROOM_CAPABILITIES.map((k) => [k, granted.has(k)])) as RoomCapabilities;
}

/** One capability, as a write route asks it. */
export function roomCan(viewer: RoomViewer, capability: RoomCapability, user?: { role?: string | null } | null): boolean {
  return roomCapabilities(viewer, user)[capability] === true;
}
