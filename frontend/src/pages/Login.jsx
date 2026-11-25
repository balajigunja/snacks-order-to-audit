import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { saveSession, HOME } from '../auth.js';

// Demo accounts so the evaluators can try every role with one click (password is the same for all)
const DEMO = [
  ['Salesman A', 'salesman.a@snacks.test'], ['Salesman B', 'salesman.b@snacks.test'],
  ['Admin', 'admin@snacks.test'], ['Production', 'production@snacks.test'],
  ['Accountant', 'accountant@snacks.test'], ['Owner', 'owner@snacks.test']
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token, user } = await api('/auth/login', 'POST', { email, password });
      saveSession(token, user);
      navigate(HOME[user.role]);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">to Snack Factory</p>
        {error && <div className="msg error">{error}</div>}
        <form onSubmit={submit}>
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
          </div>
        </form>
      </div>
      <div className="card">
        <div className="muted">Demo accounts (password: password123)</div>
        <div className="demo">
          {DEMO.map(([name, mail]) => (
            <button key={mail} className="btn btn-small" onClick={() => { setEmail(mail); setPassword('password123'); }}>{name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
