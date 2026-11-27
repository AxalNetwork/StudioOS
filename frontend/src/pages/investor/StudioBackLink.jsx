/**
 * D8731 (#8731, canvas SIV-9 and SIV-11): "‹ Studio" on a phone, at a page a
 * Studio card opened. A Studio card link carries `FROM_STUDIO` as router
 * state (`investorHomeModel.js`); the page it opens draws this first, before
 * its h1, so it is the first focus stop. Back goes one step through history,
 * so Studio comes back where it was left; with no history (a fresh tab) it
 * links to /studio. Off a phone, or reached any other way, it draws nothing:
 * the browser's own Back and the sidebar do the job there.
 */
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';

/** True when the page was opened from a Studio card (its router state says so). */
export function openedFromStudio(state) {
  return !!state && typeof state === 'object' && state.from === 'studio';
}

const CLASS = 'mb-2 inline-flex min-h-11 items-center text-[13px] font-bold text-violet-700 dark:text-violet-300';

export default function StudioBackLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  if (!phone || !openedFromStudio(location.state)) return null;
  return location.key === 'default'
    ? <Link to="/studio" className={CLASS} data-testid="link-back-studio">‹ Studio</Link>
    : <button type="button" className={CLASS} onClick={() => navigate(-1)} data-testid="link-back-studio">‹ Studio</button>;
}
