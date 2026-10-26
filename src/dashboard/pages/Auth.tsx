import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { Icon } from '../components/Icon';
import { ErrorBox } from '../components/ui';

export function AuthPage({ needsSetup, onAuthenticated }: { needsSetup: boolean; onAuthenticated: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { user } = await api<{ user: User }>(needsSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body: { email, password } });
      onAuthenticated(user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <div>
          <div className="brand">
            <span className="brand-mark">
              <Icon name="jar" />
            </span>
            jarjar
          </div>
          <h1>{needsSetup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="lead">{needsSetup ? 'Set up the owner account for this jarjar instance.' : 'Sign in to see how people use your site.'}</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            required
            minLength={needsSetup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needsSetup && <span className="hint">At least 8 characters.</span>}
        </div>
        <ErrorBox error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {needsSetup ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
