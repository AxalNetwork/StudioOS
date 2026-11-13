import { useEffect } from 'react';
import { useSetRailCrumbs } from '../../ui/railCrumbs.js';

/**
 * D775 (#2101) — a record view names its record as the rail's last crumb,
 * "section › module › record", and as the record a run on the page reads
 * (D768's `ref`). Leaving the record, or the page, drops it. The same
 * contract as CycleRoute's `RecordCrumb`, as a hook for views that are not
 * cycle pages. Outside the shell's provider the setter does nothing.
 */
export default function useRecordCrumb(title, type, id) {
  const setCrumbs = useSetRailCrumbs();
  useEffect(() => {
    setCrumbs({ record: title || null, ref: title && type && id != null ? { type, id } : null });
    return () => setCrumbs({ record: null });
  }, [setCrumbs, title, type, id]);
}
