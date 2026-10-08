/** D642 — the member's file metadata, across every company, without reading file contents. */
export type StorageAreaKey = 'data_room' | 'diligence_files' | 'research_library' | 'message_attachments' | 'interview_recordings';
export type StorageArea = {
  key: StorageAreaKey;
  files: number | null;
  bytes: number | null;
  unknown_size_files: number | null;
  recorded: boolean;
};
type Aggregate = { files: number; bytes: number | null; unknown_size_files: number | null };

const QUERIES: ReadonlyArray<[StorageAreaKey, string]> = [
  ['data_room', `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes,
    SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
    FROM data_room_files WHERE uploaded_by_user_id = ?`],
  ['diligence_files', `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes,
    SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
    FROM dd_attachments WHERE uploaded_by_user_id = ?`],
  ['research_library', `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes,
    SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
    FROM research_documents WHERE owner_user_id = ?`],
  ['message_attachments', `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes,
    SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
    FROM message_attachments WHERE uploader_user_id = ?`],
  ['interview_recordings', `SELECT COUNT(*) AS files, SUM(i.recording_size_bytes) AS bytes,
    SUM(CASE WHEN i.recording_size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
    FROM discovery_interviews i
    WHERE i.recording_r2_key IS NOT NULL AND TRIM(i.recording_r2_key) <> ''
      AND EXISTS (SELECT 1 FROM projects p JOIN users u ON u.founder_id = p.founder_id
                  WHERE p.id = i.project_id AND u.id = ?)`],
];
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

async function readArea(db: D1Database, userId: number, key: StorageAreaKey, query: string): Promise<StorageArea> {
  try {
    const row = await db.prepare(query).bind(userId).first<Aggregate>();
    if (!row || !count(row.files)) throw new Error('Unreadable storage aggregate');
    const unknown = row.files === 0 && row.unknown_size_files === null ? 0 : row.unknown_size_files;
    if (!count(unknown) || unknown > row.files || (row.bytes !== null && !count(row.bytes))) {
      throw new Error('Unreadable storage aggregate');
    }
    if (row.files > unknown && row.bytes === null) throw new Error('Unreadable storage aggregate');
    return { key, files: row.files, bytes: unknown > 0 ? null : (row.bytes ?? 0), unknown_size_files: unknown, recorded: true };
  } catch {
    // A failed area is unknown, never an invented empty store. Other areas still resolve.
    return { key, files: null, bytes: null, unknown_size_files: null, recorded: false };
  }
}

export async function readStorageUsage(db: D1Database, userId: number) {
  const areas = await Promise.all(QUERIES.map(([key, query]) => readArea(db, userId, key, query)));
  const total = (field: 'files' | 'bytes' | 'unknown_size_files'): number | null => {
    let sum = 0;
    for (const area of areas) {
      const value = area[field];
      if (!area.recorded || value === null) return null;
      sum += value;
      if (!count(sum)) return null;
    }
    return sum;
  };
  return { total_bytes: total('bytes'), files: total('files'), unknown_size_files: total('unknown_size_files'), areas };
}
