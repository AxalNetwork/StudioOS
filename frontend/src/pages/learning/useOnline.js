/** D4478: the browser's current connection, updated by its online/offline events. */
import { useEffect, useState } from 'react';

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export default function useOnline() {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const update = () => setOnline(isOnline());
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
