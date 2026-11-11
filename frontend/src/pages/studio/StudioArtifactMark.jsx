/**
 * #4551 — one group's mark: a small icon by Studio group (`validate`, `build`, `raise`, `grow` and the investor,
 * advisor and partner homes), `FileText` for a group it does not know. Drawn by `StudioModuleTile.jsx` and
 * `ModuleMapLightbox.jsx`; decorative, so `aria-hidden`.
 */
import { BarChart3, ClipboardCheck, FileText, Hammer, Handshake, Layers3, LineChart, Search } from 'lucide-react';

const GROUP_MARKS = new Map([
  ['studio', Layers3],
  ['validate', Search],
  ['build', Hammer],
  ['raise', BarChart3],
  ['grow', LineChart],
  ['investor', BarChart3],
  ['advisor', ClipboardCheck],
  ['partner', Handshake],
]);

export default function StudioArtifactMark({ group }) {
  const Icon = GROUP_MARKS.get(group) || FileText;
  return <span className="sm-artifact-mark" data-group={group} aria-hidden="true"><Icon size={17} /></span>;
}
