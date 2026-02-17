import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { setAdminSecret, clearAdminSecret } from '../lib/adminApi';
import { Lock } from 'lucide-react';

export function AdminLogin() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    setAdminSecret(secret);

    try {
      const res = await fetch('/api/admin/challenges', {
        headers: { 'x-admin-secret': secret },
      });
      if (res.ok) {
        navigate('/admin', { replace: true });
      } else {
        setError('Invalid admin secret');
        clearAdminSecret();
      }
    } catch {
      setError('Connection failed');
      clearAdminSecret();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-6 min-h-screen">
      <PaperCard className="w-full max-w-sm" elevated>
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center mb-3">
            <Lock className="w-5 h-5 text-navy" />
          </div>
          <h1 className="font-editorial font-bold text-2xl text-navy text-center">
            Front Office
          </h1>
          <p className="font-mono text-[10px] text-muted text-center uppercase tracking-[0.2em] mt-1">
            Admin Access
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Admin Secret"
            className="w-full px-3 py-3 border-2 border-navy/15 rounded font-mono text-sm
                       bg-bone text-navy placeholder:text-muted/50
                       focus:border-navy/40 focus:outline-none transition-colors"
            autoFocus
          />
          {error && (
            <p className="text-red text-xs font-mono text-center">{error}</p>
          )}
          <VintageButton
            variant="ticket"
            type="submit"
            disabled={!secret || loading}
            className="w-full"
          >
            {loading ? 'Checking...' : 'Enter'}
          </VintageButton>
        </form>
      </PaperCard>
    </div>
  );
}
