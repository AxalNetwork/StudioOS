import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { projectSearch } from '../cycles/founderToolNavigation.js';

/** The Grow breadcrumb keeps the venture even before a workspace's first read (#4862). */
export default function GrowOverviewLink() {
  const { search } = useLocation();
  return <Link to={'/grow' + projectSearch(search)}><ArrowLeft size={13} /> Grow</Link>;
}
