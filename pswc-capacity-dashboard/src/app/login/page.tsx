'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      setError('Authentication not initialized');
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/capacity'); // Redirect on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 400, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>Sign In</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: 12 }}>
          <label>Email</label><br />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ width: '100%', padding: 8, fontSize: 16 }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Password</label><br />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ width: '100%', padding: 8, fontSize: 16 }} />
        </div>
        <button type="submit"
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            fontSize: 16,
            cursor: 'pointer',
          }}>
          Sign In
        </button>
      </form>
    </main>
  );
}