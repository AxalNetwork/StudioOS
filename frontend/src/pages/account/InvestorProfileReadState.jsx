/** Read feedback shared by the investor settings cards (#6288). */
import { Unreadable } from '../../ui/Honesty.jsx';
import { LoadingRows } from './AccountCenter.jsx';

export default function InvestorProfileReadState({ error, reload }) {
  if (error) return <Unreadable what="Your investor profile" claim={error} onRetry={reload} />;
  return <div role="status" aria-label="Reading investor profile"><LoadingRows /></div>;
}
