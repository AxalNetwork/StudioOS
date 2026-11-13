/** D1345: old bookmarks move to Email; EM10 is acknowledged once per account. */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BODY, BTN, CARD, EYEBROW, MUTED, PRIMARY } from './emailParts.jsx';

export default function MessagesRedirect() {
  return <Navigate to="/email" replace state={{ messagesRetired: true }} />;
}

export function MessagesMovedNotice({ userId, storage, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const key = userId == null ? null : `axal:email:messages-moved:${userId}`;
  const [visible, setVisible] = useState(() => {
    if (!location.state?.messagesRetired) return false;
    try { return !key || (storage ?? globalThis.localStorage)?.getItem(key) !== '1'; }
    catch { return true; }
  });
  const close = () => {
    try { if (key) (storage ?? globalThis.localStorage)?.setItem(key, '1'); } catch { /* Continue when browser storage is unavailable. */ }
    setVisible(false);
    navigate('/email', { replace: true, state: null });
  };
  if (!visible) return children;
  return <section className={`${CARD} mx-auto my-8 flex w-full max-w-[560px] flex-col gap-3`} data-testid="messages-moved" aria-label="Messages is now Email">
    <span className={EYEBROW}>/messages</span>
    <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-axal-ink dark:text-gray-100">Messages is now Email</h1>
    <p className={BODY}>Email sends from your own mailbox, to the people you work with on Axal VC, and Eadwyn can write it from your records. Messages had no conversations to move.</p>
    <p className={MUTED}>Update your bookmark to /email.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} onClick={close}>Open Email</button>
      <button type="button" className={BTN} onClick={close}>Dismiss</button></div>
  </section>;
}
