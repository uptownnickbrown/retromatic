import { motion } from 'framer-motion';
import { Users, Trophy, BarChart3, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PaperCard } from '../ui/PaperCard';
import { useTodayStats } from '../../hooks/useAdmin';
import { cn } from '../../lib/utils';

export function TodayStatsCard() {
  const { data } = useTodayStats();
  const navigate = useNavigate();

  if (!data?.active) return null;

  const { sessions, avgScore, scoreDistribution, roundStats, theme, challengeId } = data;
  const maxBucket = Math.max(...(scoreDistribution ?? []), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="mb-8"
    >
      <PaperCard noPadding className="border-l-3 border-l-gold">
        <div className="px-5 py-4 border-b border-navy/8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Now Playing
                </span>
              </div>
              <h3 className="font-editorial font-bold text-lg text-navy mt-1">
                Challenge #{challengeId}
                {theme && <span className="font-normal italic text-navy/50 ml-2">"{theme}"</span>}
              </h3>
            </div>
            <button
              onClick={() => navigate(`/admin/challenge/${challengeId}`)}
              className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-navy transition-colors cursor-pointer"
            >
              Details
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 divide-x divide-navy/8 border-b border-navy/8">
          <StatCell
            icon={<Users className="w-3.5 h-3.5 text-navy/40" />}
            value={`${sessions?.completed ?? 0}/${sessions?.started ?? 0}`}
            label="Completed"
            sublabel={sessions && sessions.started > 0
              ? `${Math.round(sessions.completionRate * 100)}%`
              : undefined}
          />
          <StatCell
            icon={<Trophy className="w-3.5 h-3.5 text-gold" />}
            value={String(avgScore ?? '—')}
            label="Avg Score"
          />
          <StatCell
            icon={<BarChart3 className="w-3.5 h-3.5 text-navy/40" />}
            value={String(sessions?.started ?? 0)}
            label="Sessions"
          />
        </div>

        {/* Score distribution */}
        {scoreDistribution && scoreDistribution.some(v => v > 0) && (
          <div className="px-5 py-4 border-b border-navy/8">
            <span className="font-mono text-[9px] text-muted uppercase tracking-wider block mb-2">
              Score Distribution
            </span>
            <div className="flex items-end gap-1 h-12">
              {scoreDistribution.map((count, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className={cn(
                      'w-full rounded-sm transition-all',
                      count > 0 ? 'bg-navy/20' : 'bg-navy/5',
                    )}
                    style={{ height: `${Math.max(2, (count / maxBucket) * 40)}px` }}
                  />
                  <span className="font-mono text-[7px] text-muted/60">{i * 10}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-round most picked — rich player cards */}
        {roundStats && roundStats.length > 0 && (
          <div className="px-5 py-4">
            <span className="font-mono text-[9px] text-muted uppercase tracking-wider block mb-3">
              Most Picked Per Round
            </span>
            <div className="grid grid-cols-5 gap-2">
              {roundStats.map((rs) => (
                <MostPickedCard key={rs.roundNumber} round={rs} />
              ))}
            </div>
          </div>
        )}
      </PaperCard>
    </motion.div>
  );
}

function MostPickedCard({ round }: {
  round: {
    roundNumber: number;
    position: string;
    mostPicked: { playerName: string; pickCount: number; portraitUrl: string | null; yearOptions: number[] } | null;
  };
}) {
  const { position, mostPicked } = round;
  if (!mostPicked) {
    return (
      <div className="text-center">
        <span className="font-mono text-[9px] text-muted font-bold block">{position}</span>
        <span className="font-mono text-[8px] text-muted/40">—</span>
      </div>
    );
  }

  const lastName = mostPicked.playerName.split(' ').pop() ?? mostPicked.playerName;

  return (
    <div className="flex flex-col items-center text-center gap-1">
      {/* Portrait */}
      {mostPicked.portraitUrl ? (
        <img
          src={mostPicked.portraitUrl}
          alt={mostPicked.playerName}
          className="w-9 h-9 rounded-full object-cover border border-navy/10"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-navy/8 flex items-center justify-center">
          <span className="font-editorial text-[10px] text-navy/30">{position}</span>
        </div>
      )}
      {/* Name */}
      <span className="font-mono text-[8px] text-navy font-bold leading-tight truncate w-full">
        {lastName}
      </span>
      {/* Years */}
      <span className="font-mono text-[7px] text-muted/60 leading-tight">
        {mostPicked.yearOptions.length > 0
          ? mostPicked.yearOptions.join(', ')
          : '—'}
      </span>
    </div>
  );
}

function StatCell({
  icon,
  value,
  label,
  sublabel,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  sublabel?: string;
}) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {icon}
        <span className="font-editorial font-bold text-xl text-navy tabular-nums">{value}</span>
        {sublabel && (
          <span className="font-mono text-[10px] text-muted ml-1">{sublabel}</span>
        )}
      </div>
      <span className="font-mono text-[9px] text-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}
