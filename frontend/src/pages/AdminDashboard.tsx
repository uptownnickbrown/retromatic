import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, Reorder } from 'framer-motion';
import {
  Plus,
  Wand2,
  ChevronRight,
  Loader2,
  AlertTriangle,
  LogOut,
  Users,
  Trophy,
  Clock,
  GripVertical,
  Trash2,
} from 'lucide-react';
import {
  useAdminPipeline,
  useAdminHistory,
  useGenerateChallenge,
  useGenerateThemedBatch,
  useReorderQueue,
  useDequeueChallenges,
  useDeleteChallenge,
} from '../hooks/useAdmin';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { StatusBadge } from '../components/admin/StatusBadge';
import { HealthIndicators } from '../components/admin/HealthIndicators';
import { clearAdminSecret } from '../lib/adminApi';
import { cn } from '../lib/utils';
import type { PipelineChallenge, HistoryChallenge } from '../lib/adminApi';

function formatDateShort(dateStr: string): string {
  if (!dateStr || dateStr.startsWith('draft-')) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminPipeline();
  const { data: historyData } = useAdminHistory();
  const generateMutation = useGenerateChallenge();
  const themedMutation = useGenerateThemedBatch();
  const reorderMutation = useReorderQueue();
  const dequeueMutation = useDequeueChallenges();
  const deleteMutation = useDeleteChallenge();

  const challenges = useMemo(() => data?.challenges ?? [], [data?.challenges]);
  const history = useMemo(() => historyData?.challenges ?? [], [historyData?.challenges]);

  // Group by status
  const grouped = useMemo(() => {
    const active = challenges.filter(c => c.status === 'active');
    const queued = challenges
      .filter(c => c.status === 'scheduled')
      .sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity) || a.id - b.id);
    const draft = challenges.filter(c => c.status === 'draft');
    return { active, queued, draft };
  }, [challenges]);

  // Local queue state for optimistic drag reordering.
  // When not dragging, localQueue is null and we use grouped.queued (server data).
  // During a drag, localQueue holds the in-progress order.
  const [localQueue, setLocalQueue] = useState<PipelineChallenge[] | null>(null);
  const isDragging = useRef(false);
  const displayQueue = localQueue ?? grouped.queued;

  const handleReorder = useCallback((newOrder: PipelineChallenge[]) => {
    isDragging.current = true;
    setLocalQueue(newOrder);
  }, []);

  const handleReorderEnd = useCallback(() => {
    if (!isDragging.current || !localQueue) return;
    isDragging.current = false;
    const ids = localQueue.map(c => c.id);
    const serverIds = grouped.queued.map(c => c.id);
    if (ids.join(',') !== serverIds.join(',')) {
      reorderMutation.mutate(ids);
    }
    setLocalQueue(null);
  }, [localQueue, grouped.queued, reorderMutation]);

  const handleDequeue = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    dequeueMutation.mutate(id);
  }, [dequeueMutation]);

  const handleDeleteDraft = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete Challenge #${id}? This cannot be undone.`)) {
      deleteMutation.mutate(id);
    }
  }, [deleteMutation]);

  const handleGenerate = () => {
    generateMutation.mutate({ count: 1 });
  };

  const handleGenerateThemed = () => {
    themedMutation.mutate(25);
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
      {/* HEADER */}
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
          {/* Queue depth badge */}
          <div className={cn(
            'px-3 py-1.5 rounded border font-mono text-xs font-bold',
            grouped.queued.length >= 7
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
              : grouped.queued.length >= 3
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                : 'bg-red-400/10 border-red-400/30 text-red-600',
          )}>
            <Clock className="inline w-3 h-3 mr-1.5 -mt-px" />
            {grouped.queued.length} queued
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
          Generated {themedMutation.data.count} themed challenges and added to queue
        </motion.div>
      )}

      {themedMutation.isError && (
        <div className="mb-4 px-4 py-2 rounded bg-red/10 border border-red/20 text-red text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {themedMutation.error.message}
        </div>
      )}

      {/* Auto-promote info banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <PaperCard noPadding className="mb-8 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            <span className="font-mono text-xs text-navy/70">
              Games auto-promote at midnight ET. Drag to reorder the queue.
            </span>
          </div>
        </PaperCard>
      </motion.div>

      {/* PIPELINE SECTIONS */}
      <div className="space-y-8">
        {/* Now Playing */}
        {grouped.active.length > 0 && (
          <PipelineSection
            title="Now Playing"
            challenges={grouped.active}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
            highlight="gold"
          />
        )}

        {/* Up Next (Draggable Queue) */}
        {displayQueue.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="font-editorial font-bold text-xl text-navy">Up Next</h2>
              <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
                {displayQueue.length} {displayQueue.length === 1 ? 'challenge' : 'challenges'}
              </span>
              <span className="font-mono text-[10px] text-muted/60 italic">
                Drag to reorder
              </span>
            </div>

            <Reorder.Group
              axis="y"
              values={displayQueue}
              onReorder={handleReorder}
              className="space-y-2"
            >
              {displayQueue.map((challenge, i) => (
                <QueueItem
                  key={challenge.id}
                  challenge={challenge}
                  position={i + 1}
                  onClick={() => navigate(`/admin/challenge/${challenge.id}`)}
                  onRemove={(e) => handleDequeue(challenge.id, e)}
                  onDragEnd={handleReorderEnd}
                />
              ))}
            </Reorder.Group>
          </motion.section>
        )}

        {/* Drafts */}
        {grouped.draft.length > 0 && (
          <PipelineSection
            title="Drafts"
            subtitle="Not yet queued"
            challenges={grouped.draft}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
            onDelete={(id, e) => handleDeleteDraft(id, e)}
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

        {/* Previous Games */}
        {history.length > 0 && (
          <HistorySection
            challenges={history}
            onNavigate={(id) => navigate(`/admin/challenge/${id}`)}
          />
        )}
      </div>
    </div>
  );
}

// Draggable Queue Item

function QueueItem({
  challenge,
  position,
  onClick,
  onRemove,
  onDragEnd,
}: {
  challenge: PipelineChallenge;
  position: number;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <Reorder.Item
      value={challenge}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, boxShadow: '4px 4px 0px rgba(10,30,47,0.25)' }}
      className="list-none"
    >
      <div
        className={cn(
          'paper-card px-4 py-3 flex items-center gap-3 group cursor-grab active:cursor-grabbing',
          'hover:shadow-[3px_3px_0px_rgba(10,30,47,0.15)] transition-shadow',
        )}
      >
        {/* Drag handle */}
        <GripVertical className="w-4 h-4 text-muted/30 group-hover:text-muted/60 flex-shrink-0" />

        {/* Position number */}
        <span className="font-mono text-xs text-muted/50 font-bold w-5 flex-shrink-0 text-center tabular-nums">
          {position}
        </span>

        {/* Clickable content */}
        <button
          onClick={onClick}
          className="flex items-center gap-4 flex-1 min-w-0 text-left"
        >
          {/* ID */}
          <span className="font-mono text-xs text-muted font-bold w-10 flex-shrink-0">
            #{challenge.id}
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

        {/* Remove from queue */}
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-muted/30 hover:text-red hover:bg-red/8 transition-colors
                     opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="Remove from queue"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}

// Pipeline Section (for non-draggable lists: active, drafts)

function PipelineSection({
  title,
  subtitle,
  challenges,
  onNavigate,
  highlight,
  onDelete,
}: {
  title: string;
  subtitle?: string;
  challenges: PipelineChallenge[];
  onNavigate: (id: number) => void;
  highlight?: 'gold';
  onDelete?: (id: number, e: React.MouseEvent) => void;
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
        {subtitle && (
          <span className="font-mono text-[10px] text-muted/60 italic">
            {subtitle}
          </span>
        )}
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
              onDelete={onDelete ? (e) => onDelete(challenge.id, e) : undefined}
            />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

// Challenge Row (non-draggable)

function ChallengeRow({
  challenge,
  onClick,
  highlight,
  onDelete,
}: {
  challenge: PipelineChallenge;
  onClick: () => void;
  highlight?: 'gold';
  onDelete?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        'paper-card px-4 py-3 flex items-center gap-4 group',
        'hover:shadow-[3px_3px_0px_rgba(10,30,47,0.2)] transition-shadow',
        highlight === 'gold' && 'border-l-3 border-l-gold',
      )}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-4 flex-1 min-w-0 text-left cursor-pointer"
      >
        <StatusBadge status={challenge.status} />

        {/* ID */}
        <span className="font-mono text-xs text-muted font-bold w-10 flex-shrink-0">
          #{challenge.id}
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

      {/* Delete button */}
      {onDelete && (
        <button
          onClick={onDelete}
          className="p-1.5 rounded text-muted/30 hover:text-red hover:bg-red/8 transition-colors
                     opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="Delete challenge"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// History Section (Previous Games)

function HistorySection({
  challenges,
  onNavigate,
}: {
  challenges: HistoryChallenge[];
  onNavigate: (id: number) => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="font-editorial font-bold text-xl text-navy">Previous Games</h2>
        <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {challenges.length} played
        </span>
      </div>

      <div className="space-y-2">
        {challenges.map((challenge, i) => (
          <motion.div
            key={challenge.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.02 }}
          >
            <HistoryRow
              challenge={challenge}
              onClick={() => onNavigate(challenge.id)}
            />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

// History Row

function HistoryRow({
  challenge,
  onClick,
}: {
  challenge: HistoryChallenge;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full paper-card px-4 py-3 flex items-center gap-4 group',
        'hover:shadow-[3px_3px_0px_rgba(10,30,47,0.2)] transition-shadow cursor-pointer text-left',
        'opacity-80 hover:opacity-100',
      )}
    >
      {/* Date */}
      <span className="font-mono text-xs text-navy w-20 flex-shrink-0">
        {formatDateShort(challenge.challengeDate)}
      </span>

      {/* ID */}
      <span className="font-mono text-xs text-muted font-bold w-10 flex-shrink-0">
        #{challenge.id}
      </span>

      {/* Theme */}
      <span className="flex-1 font-editorial italic text-sm text-navy/60 truncate min-w-0">
        {challenge.theme || '—'}
      </span>

      {/* Player count */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Users className="w-3 h-3 text-muted" />
        <span className="font-mono text-xs text-navy font-bold tabular-nums">
          {challenge.playerCount}
        </span>
      </div>

      {/* Avg score */}
      {challenge.avgScore != null && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Trophy className="w-3 h-3 text-gold" />
          <span className="font-mono text-xs text-navy/70 tabular-nums">
            {challenge.avgScore}
          </span>
        </div>
      )}

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-muted/40 group-hover:text-navy transition-colors flex-shrink-0" />
    </button>
  );
}
