import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

export default function EmailChangeConfirmPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [state, setState] = useState({ status: 'loading', message: '' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'Missing token in URL' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.confirmEmailChange(token);
        if (cancelled) return;
        setState({ status: 'success', message: `Email updated to ${res.email}.`, email: res.email, revokeUntil: res.revoke_expires_at });
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', message: e.message || 'Could not confirm this change' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 text-center">
        {state.status === 'loading' && (
          <>
            <Loader2 size={36} className="text-violet-500 animate-spin mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-gray-900">Confirming your new email…</h1>
          </>
        )}
        {state.status === 'success' && (
          <>
            <CheckCircle2 size={42} className="text-emerald-500 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-gray-900 mb-1">Email confirmed</h1>
            <p className="text-sm text-gray-600 mb-4">{state.message}</p>
            {state.revokeUntil && (
              <p className="text-xs text-gray-500 mb-4">
                If you didn't authorize this, the change is reversible from your old inbox until{' '}
                {new Date(state.revokeUntil).toLocaleString()}.
              </p>
            )}
            <button onClick={() => navigate('/login')}
              className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
              Sign in with your new email
            </button>
          </>
        )}
        {state.status === 'error' && (
          <>
            <AlertTriangle size={42} className="text-red-500 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-gray-900 mb-1">Could not confirm</h1>
            <p className="text-sm text-gray-600 mb-4">{state.message}</p>
            <Link to="/login" className="text-sm text-violet-700 hover:underline">Back to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
