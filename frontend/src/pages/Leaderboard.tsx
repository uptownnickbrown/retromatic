import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trophy, Medal } from 'lucide-react';
import { useLeaderboard } from '../hooks/useChallenge';
import { cn } from '../lib/utils';
import { getOrdinalSuffix } from '../lib/utils';
import { getLegendScoreColor } from '../types';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'alltime', label: 'All Time' },
];

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy size={16} className="text-yellow-400" />;
  if (rank === 2) return <Medal size={16} className="text-slate-300" />;
  if (rank === 3) return <Medal size={16} className="text-amber-600" />;
  return <span className="text-xs font-mono text-cream/40 w-4 text-center">{rank}</span>;
}

export function Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('today');
  const { data, isLoading } = useLeaderboard(period);

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-5 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg hover:bg-cream/10 transition-colors"
        >
          <ArrowLeft size={20} className="text-cream" />
        </button>
        <h1 className="font-display text-2xl text-cream font-bold">Leaderboard</h1>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 p-1 bg-navy-light/40 rounded-xl mb-6">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'flex-1 py-2.5 rounded-lg text-sm font-bold transition-all min-h-[44px]',
              period === p.key
                ? 'bg-gold text-navy'
                : 'text-cream/60 hover:text-cream',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Leaderboard list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.leaderboard.length ? (
        <div className="text-center py-12">
          <p className="text-cream/40 text-sm">No scores yet for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.leaderboard.map((entry, i) => (
            <motion.div
              key={`${entry.rank}-${entry.displayName}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl',
                entry.rank <= 3 ? 'premium-card' : 'bg-white/5',
              )}
            >
              <div className="w-6 flex items-center justify-center">
                {getRankIcon(entry.rank)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-cream truncate">
                  {entry.displayName}
                </p>
                <p className="text-xs text-cream/40 font-mono">
                  {getOrdinalSuffix(Math.max(1, 100 - Math.round(entry.percentile)))} percentile
                </p>
              </div>
              <span className={cn(
                'font-mono font-bold text-sm',
                getLegendScoreColor(entry.score / 10),
              )}>
                {entry.score.toFixed(1)}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
