import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Wand2,
  Zap,
  ChevronRight,
  Calendar,
  Loader2,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import { useAdminPipeline, useGenerateChallenge, useGenerateThemedBatch, useActivateToday } from '../hooks/useAdmin';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { StatusBadge } from '../components/admin/StatusBadge';
import { HealthIndicators } from '../components/admin/HealthIndicators';
import { clearAdminSecret } from '../lib/adminApi';
import { cn } from '../lib/utils';
import type { PipelineChallenge } from '../lib/adminApi';

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDayAbbrev(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}

function getDayNum(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDate();
}

function getNext14Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push(d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  }
  return days;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminPipeline();
  const generateMutation = useGenerateChallenge();
  const themedMutation = useGenerateThemedBatch();
  const activateMutation = useActivateToday();

  const today = getTodayET();
  const next14 = useMemo(() => getNext14Days(), []);

  const challenges = useMemo(() => data?.challenges ?? [], [data?.challenges]);

  // Group by status
  const grouped = useMemo(() => {
    const active = challenges.filter(c => c.status === 'active');
    const scheduled = challenges
      .filter(c => c.status === 'scheduled')
      .sort((a, b) => a.challengeDate.localeCompare(b.challengeDate));
    const draft = challenges.filter(c => c.status === 'draft');
    return { active, scheduled, draft };
  }, [challenges]);

  // Map dates to challenges for calendar
  const dateMap = useMemo(() => {
    const map = new Map<string, PipelineChallenge>();
    for (const c of challenges) {
      if (c.challengeDate && c.challengeDate !== 'unassigned') {
        map.set(c.challengeDate, c);
      }
    }
    return map;
  }, [challenges]);

  // Days covered = scheduled + active with dates >= today
  const daysCovered = useMemo(() => {
    return challenges.filter(c =>
      (c.status === 'scheduled' || c.status === 'active') &&
      c.challengeDate >= today
    ).length;
  }, [challenges, today]);

  const handleGenerate = () => {
    generateMutation.mutate({ count: 1 });
  };

  const handleGenerateThemed = () => {
    themedMutation.mutate(25);
  };

  const handleActivate = () => {
    activateMutation.mutate();
  };

  const handleLogout = () => {
    clearAdminSecret();
    navigate('/admin/login', { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <Loader2 className="w-6 h-6 text-navy" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-8">
      {/* ═══ HEADER ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-end justify-between mb-8"
      >
        <div>
          <h1 className="font-editorial font-black text-4xl text-navy tracking-tight leading-none">
            Front Office
          </h1>
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em] mt-1">
            Challenge Pipeline
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Days Covered badge */}
          <div className={cn(
            'px-3 py-1.5 rounded border font-mono text-xs font-bold',
            daysCovered >= 7
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
              : daysCovered >= 3
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                : 'bg-red-400/10 border-red-400/30 text-red-600',
          )}>
            <Calendar className="inline w-3 h-3 mr-1.5 -mt-px" />
            {daysCovered} {daysCovered === 1 ? 'day' : 'days'} covered
          </div>

          <VintageButton
            variant="section"
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
          >
            <Plus className="inline w-3.5 h-3.5 mr-1 -mt-px" />
            {generateMutation.isPending ? 'Generating...' : 'Generate'}
          </VintageButton>

          <VintageButton
            variant="section"
            onClick={handleGenerateThemed}
            disabled={themedMutation.isPending}
          >
            <Wand2 className="inline w-3.5 h-3.5 mr-1 -mt-px" />
            {themedMutation.isPending ? 'Generating 25...' : '25 Themed'}
          </VintageButton>

          <VintageButton
            variant="section"
            onClick={handleActivate}
            disabled={activateMutation.isPending}
          >
            <Zap className="inline w-3.5 h-3.5 mr-1 -mt-px" />
            {activateMutation.isPending ? 'Activating...' : 'Activate Today'}
          </VintageButton>

          <button
            onClick={handleLogout}
            className="p-2 text-muted hover:text-navy transition-colors"
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </motion.div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 px-4 py-3 rounded bg-red/10 border border-red/20 text-red text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error.message}
        </div>
      )}

      {/* Mutation feedback */}
      {generateMutation.isSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-4 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono"
        >
          Generated {generateMutation.data.count} challenge(s): #{generateMutation.data.challengeIds.join(', #')}
        </motion.div>
      )}

      {themedMutation.isSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-4 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono"
        >
          Generated {themedMutation.data.count} themed challenges, scheduled starting tomorrow
        </motion.div>
      )}

      {themedMutation.isError && (
        <div className="mb-4 px-4 py-2 rounded bg-red/10 border border-red/20 text-red text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {themedMutation.error.message}
        </div>
      )}

      {/* ═══ CALENDAR STRIP ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <PaperCard noPadding className="mb-8 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-navy/8">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              Next 14 Days
            </span>
          </div>
          <div className="flex overflow-x-auto">
            {next14.map((dateStr) => {
              const challenge = dateMap.get(dateStr);
              const isToday = dateStr === today;
              const hasChallenge = !!challenge;
              const isReady = challenge?.health.roundsReady && challenge?.health.blurbsReady;

              return (
                <button
                  key={dateStr}
                  onClick={() => challenge && navigate(`/admin/challenge/${challenge.id}`)}
                  disabled={!hasChallenge}
                  className={cn(
                    'flex-shrink-0 w-[72px] py-3 flex flex-col items-center gap-1 border-r border-navy/6 transition-colors',
                    isToday && 'bg-gold/8',
                    hasChallenge && 'cursor-pointer hover:bg-navy/4',
                    !hasChallenge && 'cursor-default opacity-50',
                  )}
                >
                  <span className={cn(
                    'font-mono text-[9px] font-bold uppercase tracking-wider',
                    isToday ? 'text-gold' : 'text-muted',
                  )}>
                    {getDayAbbrev(dateStr)}
                  </span>
                  <span className={cn(
                    'font-editorial font-bold text-lg leading-none',
                    isToday ? 'text-navy' : 'text-navy/70',
                  )}>
                    {getDayNum(dateStr)}
                  </span>
                  {/* Status dot */}
                  <div className={cn(
                    'w-2 h-2 rounded-full mt-0.5',
                    !hasChallenge && 'bg-navy/10',
                    hasChallenge && isReady && 'bg-emerald-500',
                    hasChallenge && !isReady && 'bg-amber-400',
                  )} />
                  {hasChallenge && (
                    <span className="font-mono text-[8px] text-muted leading-none">
                      #{challenge.id}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </PaperCard>
      </motion.div>

      {/* ═══ PIPELINE SECTIONS ═══ */}
      <div className="space-y-8">
        {/* Today */}
        {grouped.active.length > 0 && (
          <PipelineSection
            title="Today"
            challenges={grouped.active}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
            highlight="gold"
          />
        )}

        {/* Upcoming */}
        {grouped.scheduled.length > 0 && (
          <PipelineSection
            title="Upcoming"
            challenges={grouped.scheduled}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
          />
        )}

        {/* Drafts */}
        {grouped.draft.length > 0 && (
          <PipelineSection
            title="Drafts"
            challenges={grouped.draft}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
          />
        )}

        {challenges.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <p className="text-muted font-mono text-sm mb-4">No challenges in the pipeline.</p>
            <VintageButton variant="ticket" onClick={handleGenerate}>
              <Plus className="inline w-4 h-4 mr-1.5 -mt-px" />
              Generate First Challenge
            </VintageButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pipeline Section ─────────────────────────────────────────

function PipelineSection({
  title,
  challenges,
  onNavigate,
  highlight,
}: {
  title: string;
  challenges: PipelineChallenge[];
  onNavigate: (id: number) => void;
  highlight?: 'gold';
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="font-editorial font-bold text-xl text-navy">{title}</h2>
        <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {challenges.length} {challenges.length === 1 ? 'challenge' : 'challenges'}
        </span>
      </div>

      <div className="space-y-2">
        {challenges.map((challenge, i) => (
          <motion.div
            key={challenge.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <ChallengeRow
              challenge={challenge}
              onClick={() => onNavigate(challenge.id)}
              highlight={highlight}
            />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Challenge Row ────────────────────────────────────────────

function ChallengeRow({
  challenge,
  onClick,
  highlight,
}: {
  challenge: PipelineChallenge;
  onClick: () => void;
  highlight?: 'gold';
}) {
  const dateDisplay = challenge.challengeDate === 'unassigned'
    ? 'Unassigned'
    : formatDateShort(challenge.challengeDate);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full paper-card px-4 py-3 flex items-center gap-4 group',
        'hover:shadow-[3px_3px_0px_rgba(10,30,47,0.2)] transition-shadow cursor-pointer text-left',
        highlight === 'gold' && 'border-l-3 border-l-gold',
      )}
    >
      {/* Status */}
      <StatusBadge status={challenge.status} />

      {/* ID */}
      <span className="font-mono text-xs text-muted font-bold w-10 flex-shrink-0">
        #{challenge.id}
      </span>

      {/* Date */}
      <span className={cn(
        'font-mono text-xs w-20 flex-shrink-0',
        challenge.challengeDate === 'unassigned' ? 'text-muted/60 italic' : 'text-navy',
      )}>
        {dateDisplay}
      </span>

      {/* Theme */}
      <span className="flex-1 font-editorial italic text-sm text-navy/60 truncate min-w-0">
        {challenge.theme || '—'}
      </span>

      {/* Health */}
      <div className="flex-shrink-0">
        <HealthIndicators health={challenge.health} compact />
      </div>

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-muted/40 group-hover:text-navy transition-colors flex-shrink-0" />
    </button>
  );
}
