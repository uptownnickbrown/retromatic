import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useLeaderboard } from '../hooks/useChallenge';
import { cn, getOrdinalSuffix } from '../lib/utils';
import { safeNum } from '../lib/numeric';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'alltime', label: 'All Time' },
];

export function Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('today');
  const { data, isLoading, error, refetch } = useLeaderboard(period);

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded hover:bg-navy/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-navy" />
        </button>
        <h1 className="font-editorial font-bold text-2xl text-navy">The Standings</h1>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 mb-5">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'flex-1 py-2.5 font-mono text-xs font-bold uppercase tracking-wider transition-all min-h-[44px] rounded',
              period === p.key
                ? 'text-red border-b-2 border-red'
                : 'text-muted hover:text-navy',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Leaderboard list */}
      {error ? (
        <div className="text-center py-12">
          <p className="text-red text-sm font-mono mb-3">{(error as Error).message}</p>
          <VintageButton variant="section" onClick={() => refetch()}>
            Retry
          </VintageButton>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-navy border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.leaderboard.length ? (
        <div className="text-center py-12">
          <p className="text-muted text-sm font-mono">No scores yet for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.leaderboard.map((entry, i) => {
            const isTopThree = entry.rank <= 3;

            return (
              <motion.div
                key={`${entry.rank}-${entry.displayName}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                {isTopThree ? (
                  <PaperCard className="flex items-center gap-3 px-4 py-3">
                    <span className="font-editorial font-black text-2xl text-navy w-8 text-center">
                      {entry.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-editorial font-bold text-navy truncate">
                        {entry.displayName}
                      </p>
                      <p className="text-[10px] font-mono text-muted">
                        {getOrdinalSuffix(Math.max(1, 100 - Math.round(safeNum(entry.percentile, 50))))} percentile
                      </p>
                    </div>
                    <span className={cn(
                      'font-mono font-bold text-sm',
                      safeNum(entry.score) / 10 >= 9.5 ? 'text-gold' : 'text-navy',
                    )}>
                      {safeNum(entry.score).toFixed(1)}
                    </span>
                  </PaperCard>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b border-navy/6">
                    <span className="font-mono text-xs text-muted w-8 text-center">
                      {entry.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-navy truncate">
                        {entry.displayName}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-muted">
                      {safeNum(entry.score).toFixed(1)}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
