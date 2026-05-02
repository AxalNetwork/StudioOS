import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

export default function EmailChangeRevokePage() {
  const [params] = useSearchParams();
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
        const res = await api.revokeEmailChange(token);
        if (cancelled) return;
        setState({ status: 'success', message: `Email rolled back to ${res.email}. All sessions have been signed out as a precaution.` });
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', message: e.message || 'Could not revoke this change' });
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
            <h1 className="text-lg font-semibold text-gray-900">Revoking the email change…</h1>
          </>
        )}
        {state.status === 'success' && (
          <>
            <CheckCircle2 size={42} className="text-emerald-500 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-gray-900 mb-1">Change reversed</h1>
            <p className="text-sm text-gray-600 mb-4">{state.message}</p>
            <Link to="/login" className="inline-block w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
              Sign in
            </Link>
          </>
        )}
        {state.status === 'error' && (
          <>
            <AlertTriangle size={42} className="text-red-500 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-gray-900 mb-1">Could not revoke</h1>
            <p className="text-sm text-gray-600 mb-4">{state.message}</p>
            <Link to="/login" className="text-sm text-violet-700 hover:underline">Back to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
