import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  Wand2,
  Image,
  Users,
  Play,
  CalendarPlus,
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
  Check,
  X,
} from 'lucide-react';
import {
  useAdminChallengeDetail,
  useAdminChallengeHealth,
  useGenerateBlurbs,
  usePreseedStats,
  useGeneratePortraits,
  useDeleteChallenge,
  useScheduleChallenges,
} from '../hooks/useAdmin';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { StatusBadge } from '../components/admin/StatusBadge';
import { cn } from '../lib/utils';
import type { AdminRound, AdminRoundOption } from '../lib/adminApi';

function formatDateLong(dateStr: string): string {
  if (!dateStr || dateStr === 'unassigned') return 'Unassigned';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function AdminChallengeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = id ? parseInt(id) : null;

  const { data: detail, isLoading: detailLoading } = useAdminChallengeDetail(challengeId);
  const { data: health } = useAdminChallengeHealth(challengeId);

  const blurbsMutation = useGenerateBlurbs();
  const preseedMutation = usePreseedStats();
  const portraitsMutation = useGeneratePortraits();
  const deleteMutation = useDeleteChallenge();
  const scheduleMutation = useScheduleChallenges();

  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());
  const [scheduleDate, setScheduleDate] = useState('');
  const [showScheduleInput, setShowScheduleInput] = useState(false);

  const justPlaytested = searchParams.get('playtested') === 'true';

  const toggleRound = (roundNum: number) => {
    setExpandedRounds(prev => {
      const next = new Set(prev);
      if (next.has(roundNum)) next.delete(roundNum);
      else next.add(roundNum);
      return next;
    });
  };

  const expandAll = () => {
    if (!detail) return;
    setExpandedRounds(new Set(detail.rounds.map(r => r.roundNumber)));
  };

  const collapseAll = () => setExpandedRounds(new Set());

  const handleGenerateBlurbs = () => {
    if (challengeId) blurbsMutation.mutate(challengeId);
  };

  const handleGeneratePortraits = () => {
    if (challengeId) portraitsMutation.mutate(challengeId);
  };

  const handlePreseedStats = () => {
    if (challengeId) preseedMutation.mutate(challengeId);
  };

  const handleDelete = () => {
    if (!challengeId) return;
    if (window.confirm(`Delete Challenge #${challengeId}? This cannot be undone.`)) {
      deleteMutation.mutate(challengeId, {
        onSuccess: () => navigate('/admin', { replace: true }),
      });
    }
  };

  const handleSchedule = () => {
    if (!challengeId || !scheduleDate) return;
    scheduleMutation.mutate(
      { challengeIds: [challengeId], startDate: scheduleDate },
      { onSuccess: () => setShowScheduleInput(false) },
    );
  };

  if (detailLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <Loader2 className="w-6 h-6 text-navy" />
        </motion.div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <button onClick={() => navigate('/admin')} className="btn-ghost flex items-center gap-1 mb-6 px-0">
          <ArrowLeft className="w-4 h-4" /> Pipeline
        </button>
        <p className="text-muted font-mono text-sm">Challenge not found.</p>
      </div>
    );
  }

  const { challenge, rounds } = detail;

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-8">
      {/* ═══ BACK LINK ═══ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <button
          onClick={() => navigate('/admin')}
          className="btn-ghost flex items-center gap-1 mb-6 px-0"
        >
          <ArrowLeft className="w-4 h-4" /> Pipeline
        </button>
      </motion.div>

      {/* Playtest success banner */}
      {justPlaytested && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 px-4 py-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          Playtest complete. Review the rounds below to verify content quality.
        </motion.div>
      )}

      {/* ═══ HEADER ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-editorial font-black text-3xl text-navy tracking-tight leading-none">
            Challenge #{challenge.id}
          </h1>
          <StatusBadge status={challenge.status} />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-muted">
            {formatDateLong(challenge.challengeDate)}
          </span>
          {challenge.theme && (
            <>
              <span className="text-muted/30">|</span>
              <span className="font-editorial text-sm text-navy/60 italic">
                "{challenge.theme}"
              </span>
            </>
          )}
        </div>
      </motion.div>

      {/* ═══ HEALTH SUMMARY ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-6"
      >
        <PaperCard noPadding>
          <div className="grid grid-cols-4 divide-x divide-navy/8">
            <HealthMetric
              value={health ? `${health.rounds}/${health.roundsExpected}` : '—'}
              label="Rounds"
              ready={health?.roundsReady}
            />
            <HealthMetric
              value={health ? `${health.blurbs.present}/${health.blurbs.total}` : '—'}
              label="Blurbs"
              ready={health?.blurbsReady}
            />
            <HealthMetric
              value={health ? `${health.portraits.present}/${health.portraits.total}` : '—'}
              label="Portraits"
              ready={health?.portraitsReady}
            />
            <HealthMetric
              value={
                health?.legendScoreRange
                  ? `${health.legendScoreRange.min.toFixed(1)} – ${health.legendScoreRange.max.toFixed(1)}`
                  : '—'
              }
              label="Score Range"
            />
          </div>
        </PaperCard>
      </motion.div>

      {/* ═══ ACTION BAR ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-3 mb-8 flex-wrap"
      >
        <VintageButton
          variant="section"
          onClick={handleGenerateBlurbs}
          disabled={blurbsMutation.isPending}
        >
          {blurbsMutation.isPending ? (
            <>
              <Loader2 className="inline w-3.5 h-3.5 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="inline w-3.5 h-3.5 mr-1.5 -mt-px" />
              Generate Blurbs
            </>
          )}
        </VintageButton>

        <VintageButton
          variant="section"
          onClick={handleGeneratePortraits}
          disabled={portraitsMutation.isPending}
        >
          {portraitsMutation.isPending ? (
            <>
              <Loader2 className="inline w-3.5 h-3.5 mr-1.5 animate-spin" />
              Portraits...
            </>
          ) : (
            <>
              <Image className="inline w-3.5 h-3.5 mr-1.5 -mt-px" />
              Generate Portraits
            </>
          )}
        </VintageButton>

        <VintageButton
          variant="section"
          onClick={handlePreseedStats}
          disabled={preseedMutation.isPending}
        >
          {preseedMutation.isPending ? (
            <>
              <Loader2 className="inline w-3.5 h-3.5 mr-1.5 animate-spin" />
              Seeding...
            </>
          ) : (
            <>
              <Users className="inline w-3.5 h-3.5 mr-1.5 -mt-px" />
              Preseed Stats
            </>
          )}
        </VintageButton>

        {/* Schedule */}
        {showScheduleInput ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              className="px-2 py-1.5 border-2 border-navy/15 rounded font-mono text-xs bg-bone text-navy
                         focus:border-navy/40 focus:outline-none"
            />
            <button
              onClick={handleSchedule}
              disabled={!scheduleDate || scheduleMutation.isPending}
              className="p-1.5 rounded bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
              title="Confirm schedule"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowScheduleInput(false)}
              className="p-1.5 rounded text-muted hover:text-navy transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <VintageButton
            variant="section"
            onClick={() => setShowScheduleInput(true)}
          >
            <CalendarPlus className="inline w-3.5 h-3.5 mr-1.5 -mt-px" />
            Schedule
          </VintageButton>
        )}

        <VintageButton
          variant="ticket"
          onClick={() => navigate(`/play?playtest=${challengeId}`)}
        >
          <Play className="inline w-3.5 h-3.5 mr-1.5 -mt-px" />
          Playtest
        </VintageButton>

        <div className="flex-1" />

        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="btn-ghost text-red hover:text-red-dark flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </motion.div>

      {/* Mutation feedback */}
      <AnimatePresence>
        {blurbsMutation.isSuccess && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 px-4 py-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono"
          >
            Blurbs generated: {blurbsMutation.data.generated} succeeded, {blurbsMutation.data.failed} failed
          </motion.div>
        )}
        {blurbsMutation.isError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 px-4 py-3 rounded bg-red/10 border border-red/20 text-red text-xs font-mono flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {blurbsMutation.error.message}
          </motion.div>
        )}
        {portraitsMutation.isSuccess && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 px-4 py-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono"
          >
            Portraits: {portraitsMutation.data.generated} generated, {portraitsMutation.data.skipped} skipped, {portraitsMutation.data.failed} failed
          </motion.div>
        )}
        {portraitsMutation.isError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 px-4 py-3 rounded bg-red/10 border border-red/20 text-red text-xs font-mono flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {portraitsMutation.error.message}
          </motion.div>
        )}
        {preseedMutation.isSuccess && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 px-4 py-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-mono"
          >
            Pre-seeded {preseedMutation.data.totalPicks} picks across {preseedMutation.data.roundsSeeded} rounds
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ ROUNDS ═══ */}
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-editorial font-bold text-xl text-navy">Rounds</h2>
        <div className="flex gap-2">
          <button onClick={expandAll} className="btn-ghost text-xs px-2 py-1">
            Expand all
          </button>
          <button onClick={collapseAll} className="btn-ghost text-xs px-2 py-1">
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {rounds.map((round, i) => (
          <motion.div
            key={round.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + i * 0.02 }}
          >
            <RoundSection
              round={round}
              isExpanded={expandedRounds.has(round.roundNumber)}
              onToggle={() => toggleRound(round.roundNumber)}
            />
          </motion.div>
        ))}
      </div>

      {rounds.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted font-mono text-sm">No rounds generated yet.</p>
        </div>
      )}
    </div>
  );
}

// ─── Health Metric Cell ──────────────────────────────────────

function HealthMetric({
  value,
  label,
  ready,
}: {
  value: string;
  label: string;
  ready?: boolean;
}) {
  return (
    <div className="px-5 py-4 text-center">
      <div className="flex items-center justify-center gap-2 mb-1">
        {ready !== undefined && (
          <div className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            ready ? 'bg-emerald-500' : 'bg-red-400',
          )} />
        )}
        <span className="mono-stat text-lg">{value}</span>
      </div>
      <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ─── Round Section ───────────────────────────────────────────

function RoundSection({
  round,
  isExpanded,
  onToggle,
}: {
  round: AdminRound;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Quick health check for this round
  const blurbCount = round.options.reduce((sum, opt) => {
    const blurbs = opt.blurbs ?? {};
    return sum + opt.yearScores.filter(ys => blurbs[String(ys.year)]?.trim()).length;
  }, 0);
  const totalYears = round.options.reduce((sum, opt) => sum + opt.yearScores.length, 0);
  const portraitCount = round.options.filter(o => o.portraitUrl).length;

  return (
    <PaperCard noPadding>
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy/2 transition-colors"
      >
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-muted" />
        </motion.div>

        <span className="font-editorial font-bold text-base text-navy">
          Round {round.roundNumber}
        </span>

        <span className="px-2 py-0.5 bg-navy/8 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-navy/70">
          {round.position}
        </span>

        <div className="flex-1" />

        {/* Inline health summary */}
        <span className="font-mono text-[10px] text-muted">
          {round.options.length} players
        </span>
        <span className="text-muted/30">|</span>
        <span className={cn(
          'font-mono text-[10px]',
          blurbCount === totalYears ? 'text-emerald-600' : 'text-red-400',
        )}>
          {blurbCount}/{totalYears} blurbs
        </span>
        <span className="text-muted/30">|</span>
        <span className={cn(
          'font-mono text-[10px]',
          portraitCount === round.options.length ? 'text-emerald-600' : 'text-red-400',
        )}>
          {portraitCount}/{round.options.length} portraits
        </span>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-navy/8 px-4 py-4">
              <div className="grid grid-cols-3 gap-4">
                {round.options.map(option => (
                  <PlayerCard key={option.id} option={option} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PaperCard>
  );
}

// ─── Player Card ─────────────────────────────────────────────

function PlayerCard({ option }: { option: AdminRoundOption }) {
  const [expandedBlurbs, setExpandedBlurbs] = useState<Set<number>>(new Set());
  const blurbs = option.blurbs ?? {};

  const toggleBlurb = (year: number) => {
    setExpandedBlurbs(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div className="bg-bone/60 border border-navy/8 rounded p-3">
      {/* Player header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Portrait */}
        <div className="w-16 h-[76px] flex-shrink-0 bg-paper rounded overflow-hidden border border-navy/8 flex items-center justify-center">
          {option.portraitUrl ? (
            <img
              src={option.portraitUrl}
              alt={option.playerName}
              className="w-full h-full object-cover object-top mix-blend-multiply"
            />
          ) : (
            <img
              src="/player.svg"
              alt=""
              className="w-10 h-12 opacity-15"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-editorial font-bold text-sm text-navy leading-tight truncate">
            {option.playerName}
          </h4>
          <p className="font-mono text-[9px] text-muted mt-0.5">
            ID: {option.playerId}
          </p>
          <p className="font-mono text-[9px] text-muted">
            Slot {option.playerSlot}
          </p>
        </div>
      </div>

      {/* Year options */}
      <div className="space-y-1.5">
        {option.yearScores.map(ys => {
          const hasBlurb = !!blurbs[String(ys.year)]?.trim();
          const isBlurbExpanded = expandedBlurbs.has(ys.year);

          return (
            <div key={ys.year}>
              <div className="flex items-center gap-2">
                {/* Year */}
                <span className="font-mono text-xs font-bold text-navy w-10 flex-shrink-0">
                  {ys.year}
                </span>

                {/* Legend Score */}
                <span className={cn(
                  'font-mono text-xs font-bold tabular-nums',
                  ys.legendScore >= 9.5 ? 'text-gold'
                    : ys.legendScore >= 6.0 ? 'text-navy'
                      : 'text-muted',
                )}>
                  {ys.legendScore.toFixed(1)}
                </span>

                <div className="flex-1" />

                {/* Blurb status dot */}
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  hasBlurb ? 'bg-emerald-500' : 'bg-red-400',
                )} />

                {/* Toggle blurb preview */}
                {hasBlurb && (
                  <button
                    onClick={() => toggleBlurb(ys.year)}
                    className="p-0.5 text-muted hover:text-navy transition-colors"
                    title={isBlurbExpanded ? 'Hide blurb' : 'Show blurb'}
                  >
                    {isBlurbExpanded
                      ? <EyeOff className="w-3 h-3" />
                      : <Eye className="w-3 h-3" />
                    }
                  </button>
                )}
              </div>

              {/* Blurb preview */}
              <AnimatePresence>
                {isBlurbExpanded && hasBlurb && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <p className="font-editorial text-sm text-navy/60 italic leading-snug mt-1 pl-2 border-l-2 border-navy/10">
                      {blurbs[String(ys.year)]}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
