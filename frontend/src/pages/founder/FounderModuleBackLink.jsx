import { Link, useLocation } from 'react-router-dom';
import { editorModuleLink, MODULE_LINK_CLASS } from '../cycles/founderToolNavigation.js';

/** One quiet module return above an editor; other licences retain their own navigation. */
export default function FounderModuleBackLink({ user }) {
  const location = useLocation();
  const link = editorModuleLink(location.pathname, location.search, user);
  return link ? <Link to={link.href} className={MODULE_LINK_CLASS + ' mb-3'} data-testid="founder-module-back">{link.label}</Link> : null;
}
