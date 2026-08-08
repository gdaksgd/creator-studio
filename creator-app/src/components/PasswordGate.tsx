import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean>(
    () => !!localStorage.getItem('auth_password')
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  // Verify stored password on mount
  useEffect(() => {
    const stored = localStorage.getItem('auth_password');
    if (!stored) {
      setChecking(false);
      return;
    }
    // Verify with backend
    api.checkPassword(stored)
      .then((res) => {
        if (res.success) {
          setAuthenticated(true);
        } else {
          localStorage.removeItem('auth_password');
          setAuthenticated(false);
        }
      })
      .catch(() => {
        // Backend might be down, allow local mode
        setAuthenticated(true);
      })
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    api.checkPassword(password)
      .then((res) => {
        if (res.success) {
          localStorage.setItem('auth_password', password);
          setAuthenticated(true);
          setPassword('');
        } else {
          setError('密码错误，请重试');
        }
      })
      .catch(() => {
        // If backend is down, check locally (for dev mode without backend)
        if (password === '125197') {
          localStorage.setItem('auth_password', password);
          setAuthenticated(true);
          setPassword('');
        } else {
          setError('无法连接服务器，请检查网络');
        }
      });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">正在验证...</div>
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-6">
            <div className="inline-block w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl mb-3 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-800">Creator Studio</h1>
            <p className="text-sm text-gray-500 mt-1">自媒体创作助手</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入访问密码"
                autoFocus
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                className="w-full px-4 py-3 text-center text-2xl tracking-[0.5em] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={!password}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              进入
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">仅限授权访问</p>
      </div>
    </div>
  );
}
