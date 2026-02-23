import { useState, useMemo, useCallback, useRef, useEffect, startTransition, useReducer } from 'react';
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
  Sparkles,
  BarChart3,
  Zap,
  Play,
} from 'lucide-react';
import {
  useAdminPipeline,
  useAdminHistory,
  useGenerateChallenge,
  useGenerateThemedBatch,
  useReorderQueue,
  useDeleteChallenge,
  useBakeChallenge,
  usePromoteNext,
  useForceActivate,
} from '../hooks/useAdmin';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { HealthIndicators } from '../components/admin/HealthIndicators';
import { TodayStatsCard } from '../components/admin/TodayStatsCard';
import { InlineThemeEditor } from '../components/admin/InlineThemeEditor';
import { clearAdminSecret } from '../lib/adminApi';
import { streamBakeAll } from '../lib/adminApi';
import { AgentChatPanel } from '../components/admin/AgentChatPanel';
import { INITIAL_SESSION_STATE, agentReducer } from '../lib/adminApi';
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
  const deleteMutation = useDeleteChallenge();
  const bakeMutation = useBakeChallenge();
  const promoteMutation = usePromoteNext();
  const forceActivateMutation = useForceActivate();
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentSession, agentDispatch] = useReducer(agentReducer, INITIAL_SESSION_STATE);

  // Bake-all SSE state
  const [bakeAllProgress, setBakeAllProgress] = useState<{
    running: boolean;
    total: number;
    current: number;
    currentTheme: string | null;
  } | null>(null);
  const bakeAllAbortRef = useRef<{ abort: () => void } | null>(null);

  const handleBakeAll = useCallback(() => {
    if (bakeAllProgress?.running) return;
    setBakeAllProgress({ running: true, total: 0, current: 0, currentTheme: null });
    const stream = streamBakeAll((event) => {
      const e = event as Record<string, unknown>;
      if (e.type === 'start') {
        setBakeAllProgress({ running: true, total: e.total as number, current: 0, currentTheme: null });
      } else if (e.type === 'progress') {
        setBakeAllProgress(prev => prev ? { ...prev, current: (e.index as number) + 1, currentTheme: e.theme as string | null } : prev);
      } else if (e.type === 'complete' || e.type === 'error') {
        setBakeAllProgress(null);
        bakeAllAbortRef.current = null;
      }
    });
    bakeAllAbortRef.current = stream;
  }, [bakeAllProgress]);

  const challenges = useMemo(() => data?.challenges ?? [], [data?.challenges]);
  const history = useMemo(() => historyData?.challenges ?? [], [historyData?.challenges]);

  // Group by status
  const grouped = useMemo(() => {
    const active = challenges.filter(c => c.status === 'active');
    const queued = challenges
      .filter(c => c.status === 'scheduled' || c.status === 'draft')
      .sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity) || a.id - b.id);
    return { active, queued };
  }, [challenges]);

  // Local queue state for optimistic drag reordering.
  // When not dragging, localQueue is null and we use grouped.queued (server data).
  // During a drag, localQueue holds the in-progress order.
  const [localQueue, setLocalQueue] = useState<PipelineChallenge[] | null>(null);
  const isDragging = useRef(false);
  const displayQueue = localQueue ?? grouped.queued;

  // Clear local queue once server data catches up to our optimistic order
  useEffect(() => {
    if (!localQueue || isDragging.current) return;
    const localIds = localQueue.map(c => c.id).join(',');
    const serverIds = grouped.queued.map(c => c.id).join(',');
    if (localIds === serverIds) {
      startTransition(() => setLocalQueue(null));
    }
  }, [grouped.queued, localQueue]);

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
      reorderMutation.mutate(ids, {
        onError: () => setLocalQueue(null), // revert on failure
      });
      // Keep localQueue alive — it clears when server data catches up
    } else {
      setLocalQueue(null);
    }
  }, [localQueue, grouped.queued, reorderMutation]);

  const handleRemoveFromQueue = useCallback((id: number, e: React.MouseEvent) => {
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

          <VintageButton
            variant="section"
            onClick={() => setAgentOpen(true)}
          >
            <Sparkles className="inline w-3.5 h-3.5 mr-1 -mt-px" />
            AI Builder
          </VintageButton>

          <button
            onClick={() => navigate('/admin/analytics')}
            className="p-2 text-muted hover:text-navy transition-colors"
            title="Analytics"
          >
            <BarChart3 className="w-4 h-4" />
          </button>

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
            <span className="font-mono text-xs text-navy/70 flex-1">
              Games auto-promote at midnight ET. Drag to reorder the queue.
            </span>
            <button
              onClick={() => {
                if (window.confirm('Activate the next queued challenge now? This will complete the current active challenge (if any).')) {
                  promoteMutation.mutate();
                }
              }}
              disabled={promoteMutation.isPending || grouped.queued.length === 0}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                promoteMutation.isPending
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                  : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy disabled:opacity-40',
              )}
            >
              {promoteMutation.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Promoting...</>
              ) : (
                <><Play className="w-3 h-3" /> Promote Next</>
              )}
            </button>
          </div>
          {promoteMutation.isSuccess && (
            <div className="px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 font-mono text-xs text-emerald-700">
              {promoteMutation.data.activated
                ? `Activated challenge #${promoteMutation.data.activated}`
                : 'No queued challenges to activate'}
            </div>
          )}
        </PaperCard>
      </motion.div>

      {/* TODAY STATS */}
      <TodayStatsCard />

      {/* PIPELINE SECTIONS */}
      <div className="space-y-8">
        {/* Up Next (Draggable Queue) */}
        {displayQueue.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-editorial font-bold text-xl text-navy">Up Next</h2>
              <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
                {displayQueue.length} {displayQueue.length === 1 ? 'challenge' : 'challenges'}
              </span>
              <span className="font-mono text-[10px] text-muted/60 italic">
                Drag to reorder
              </span>
              <div className="flex-1" />
              <button
                onClick={handleBakeAll}
                disabled={!!bakeAllProgress?.running}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                  bakeAllProgress?.running
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                    : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy',
                )}
              >
                {bakeAllProgress?.running ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Baking {bakeAllProgress.current}/{bakeAllProgress.total}...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    Bake All
                  </>
                )}
              </button>
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
                  onRemove={(e) => handleRemoveFromQueue(challenge.id, e)}
                  onBake={(e) => { e.stopPropagation(); bakeMutation.mutate(challenge.id); }}
                  isBaking={bakeMutation.isPending && bakeMutation.variables === challenge.id}
                  onActivate={(e) => {
                    e.stopPropagation();
                    const theme = challenge.theme ? ` ("${challenge.theme}")` : '';
                    if (window.confirm(`Activate challenge #${challenge.id}${theme} right now? This will deactivate the current active challenge.`)) {
                      forceActivateMutation.mutate(challenge.id);
                    }
                  }}
                  isActivating={forceActivateMutation.isPending && forceActivateMutation.variables === challenge.id}
                  onDragEnd={handleReorderEnd}
                />
              ))}
            </Reorder.Group>
          </motion.section>
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

      {/* AI Builder Panel */}
      <AgentChatPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        sessionState={agentSession}
        dispatch={agentDispatch}
      />
    </div>
  );
}

// Draggable Queue Item

function QueueItem({
  challenge,
  position,
  onClick,
  onRemove,
  onBake,
  isBaking,
  onActivate,
  isActivating,
  onDragEnd,
}: {
  challenge: PipelineChallenge;
  position: number;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onBake: (e: React.MouseEvent) => void;
  isBaking: boolean;
  onActivate: (e: React.MouseEvent) => void;
  isActivating: boolean;
  onDragEnd: () => void;
}) {
  const isComplete = challenge.health.blurbsReady && challenge.health.portraitsReady;

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

        {/* ID */}
        <button
          onClick={onClick}
          className="font-mono text-xs text-muted font-bold w-10 flex-shrink-0 text-left cursor-pointer"
        >
          #{challenge.id}
        </button>

        {/* Theme — inline editable */}
        <InlineThemeEditor challengeId={challenge.id} theme={challenge.theme} />

        {/* Health */}
        <div className="flex-shrink-0">
          <HealthIndicators health={challenge.health} enrichmentPhase={challenge.enrichmentPhase} compact />
        </div>

        {/* Bake button — only show when incomplete */}
        {!isComplete && (
          <button
            onClick={onBake}
            disabled={isBaking}
            className="p-1.5 rounded text-amber-600 hover:bg-amber-500/10 transition-colors
                       opacity-0 group-hover:opacity-100 disabled:opacity-100 flex-shrink-0"
            title="Bake (blurbs + portraits + preseed)"
          >
            {isBaking
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />
            }
          </button>
        )}

        {/* Activate now */}
        <button
          onClick={onActivate}
          disabled={isActivating}
          className="p-1.5 rounded text-emerald-600/50 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors
                     opacity-0 group-hover:opacity-100 disabled:opacity-100 flex-shrink-0"
          title="Activate now"
        >
          {isActivating
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Zap className="w-3.5 h-3.5" />
          }
        </button>

        {/* Detail link */}
        <button
          onClick={onClick}
          className="p-1.5 text-muted/40 hover:text-navy transition-colors flex-shrink-0 cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
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
