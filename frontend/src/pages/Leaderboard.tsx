import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trophy, Medal } from 'lucide-react';
import { useLeaderboard } from '../hooks/useChallenge';
import { cn } from '../lib/utils';
import { getOrdinalSuffix } from '../lib/utils';
import { getLegendScoreTier } from '../types';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'alltime', label: 'All Time' },
];

function getRankDisplay(rank: number) {
  if (rank === 1) return <Trophy size={18} className="text-yellow-400" />;
  if (rank === 2) return <Medal size={18} className="text-slate-300" />;
  if (rank === 3) return <Medal size={18} className="text-amber-600" />;
  return <span className="font-score text-sm text-cardboard/40 w-5 text-center">{rank}</span>;
}

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
          className="p-2 rounded-lg hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft size={22} className="text-cardboard" />
        </button>
        <h1 className="font-heading text-2xl text-cardboard">Leaderboard</h1>
      </div>

      {/* Period tabs — scoreboard style */}
      <div className="flex gap-1 p-1 rounded-lg mb-5" style={{ background: 'rgba(0,0,0,0.3)' }}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'flex-1 py-2.5 rounded-md font-heading text-sm transition-all min-h-[44px]',
              period === p.key
                ? 'card-banner'
                : 'text-cardboard/50 hover:text-cardboard',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Leaderboard list */}
      {error ? (
        <div className="text-center py-12">
          <p className="text-red-400/70 text-sm font-body mb-3">{(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="card-banner-blue px-5 py-2.5 text-sm min-h-[44px]"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-3 border-card-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.leaderboard.length ? (
        <div className="text-center py-12">
          <p className="text-cardboard/40 text-sm font-body">No scores yet for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.leaderboard.map((entry, i) => (
            <motion.div
              key={`${entry.rank}-${entry.displayName}`}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl',
                entry.rank <= 3 ? 'card' : '',
              )}
              style={entry.rank > 3 ? { background: 'rgba(255,255,255,0.06)' } : undefined}
            >
              <div className="w-7 flex items-center justify-center">
                {getRankDisplay(entry.rank)}
              </div>
              <div className="flex-1 min-w-0 relative z-10">
                <p className={cn(
                  'text-sm font-heading truncate',
                  entry.rank <= 3 ? 'text-field-dark' : 'text-cardboard',
                )}>
                  {entry.displayName}
                </p>
                <p className={cn(
                  'text-xs font-body',
                  entry.rank <= 3 ? 'text-field-dark/50' : 'text-cardboard/40',
                )}>
                  {getOrdinalSuffix(Math.max(1, 100 - Math.round(entry.percentile)))} percentile
                </p>
              </div>
              <span
                className={cn(
                  'font-score font-bold text-sm px-2 py-1 rounded text-white relative z-10',
                  getLegendScoreTier(entry.score / 10),
                )}
                style={{
                  background: 'var(--ls-bg)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {entry.score.toFixed(1)}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
