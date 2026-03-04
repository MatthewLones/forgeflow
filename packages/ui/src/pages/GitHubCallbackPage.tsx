import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

export function GitHubCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code received');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/github/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).error || 'Failed to connect');
        }

        setStatus('success');

        // If opened as a popup, close it
        if (window.opener) {
          window.close();
        } else {
          // Redirect back to dashboard after a short delay
          setTimeout(() => navigate('/'), 2000);
        }
      } catch (err: any) {
        setStatus('error');
        setErrorMsg(err.message);
      }
    })();
  }, [searchParams, navigate]);

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        {status === 'processing' && (
          <>
            <div className="w-6 h-6 border-2 border-gray-800 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-600">Connecting to GitHub...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <svg className="w-8 h-8 text-emerald-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-gray-800 font-medium">Connected to GitHub!</p>
            <p className="text-xs text-gray-500">You can close this window.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <svg className="w-8 h-8 text-red-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p className="text-sm text-red-600 font-medium">Failed to connect</p>
            <p className="text-xs text-gray-500">{errorMsg}</p>
            <button
              onClick={() => navigate('/')}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
