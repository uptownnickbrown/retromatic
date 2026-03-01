import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Image, Loader2, X } from 'lucide-react';
import { PaperCard } from '../ui/PaperCard';
import { getPregenPreview, streamPregenPortraits } from '../../lib/adminApi';
import type { PregenStreamEvent } from '../../lib/adminApi';
import { cn } from '../../lib/utils';

const SCORE_PRESETS = [6.0, 7.0, 8.0, 9.0];

interface PregenState {
  running: boolean;
  total: number;
  done: number;
  generated: number;
  failed: number;
  latestPlayer: string | null;
  latestAttempts: number;
  completeSummary: { generated: number; failed: number; skipped: number } | null;
}

export function PortraitPregenPanel() {
  const [minScore, setMinScore] = useState(7.0);
  const [pregen, setPregen] = useState<PregenState | null>(null);

  const abortRef = useRef<{ abort: () => void } | null>(null);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['admin', 'pregen-preview', minScore],
    queryFn: () => getPregenPreview(minScore),
    staleTime: 30_000,
  });

  const handleStart = useCallback(() => {
    if (pregen?.running) return;

    setPregen({
      running: true,
      total: 0,
      done: 0,
      generated: 0,
      failed: 0,
      latestPlayer: null,
      latestAttempts: 0,
      completeSummary: null,
    });

    const stream = streamPregenPortraits(minScore, (event: PregenStreamEvent) => {
      if (event.type === 'start') {
        setPregen(prev => prev ? {
          ...prev,
          total: event.toGenerate ?? 0,
        } : prev);
      } else if (event.type === 'progress') {
        setPregen(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            done: event.index ?? prev.done + 1,
            generated: event.pass ? prev.generated + 1 : prev.generated,
            failed: event.pass ? prev.failed : prev.failed + 1,
            latestPlayer: event.playerName ?? prev.latestPlayer,
            latestAttempts: event.attempts ?? 0,
          };
        });
      } else if (event.type === 'complete') {
        setPregen(prev => prev ? {
          ...prev,
          running: false,
          completeSummary: {
            generated: event.generated ?? prev.generated,
            failed: event.failed ?? prev.failed,
            skipped: event.skipped ?? 0,
          },
        } : prev);
        abortRef.current = null;
      } else if (event.type === 'error') {
        setPregen(prev => prev ? { ...prev, running: false } : prev);
        abortRef.current = null;
      }
    });
    abortRef.current = stream;
  }, [minScore, pregen?.running]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPregen(prev => prev ? { ...prev, running: false } : prev);
  }, []);

  const isRunning = pregen?.running ?? false;
  const progressPct = pregen && pregen.total > 0 ? (pregen.done / pregen.total) * 100 : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.14 }}
    >
      <h2 className="font-editorial font-bold text-xl text-navy mb-3">Portrait Pre-generation</h2>

      <PaperCard>
        {/* Score threshold selector */}
        <div className="flex items-center gap-3 mb-4">
          <span className="font-mono text-xs text-navy/70">Min Sandlot Score:</span>
          <div className="flex gap-1.5">
            {SCORE_PRESETS.map(score => (
              <button
                key={score}
                onClick={() => setMinScore(score)}
                disabled={isRunning}
                className={cn(
                  'px-3 py-1.5 rounded border font-mono text-xs font-bold transition-colors',
                  score === minScore
                    ? 'bg-navy text-cream border-navy'
                    : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy',
                  isRunning && 'opacity-50 cursor-not-allowed',
                )}
              >
                {score.toFixed(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Preview stats */}
        {previewLoading ? (
          <div className="flex items-center gap-2 text-navy/50 font-mono text-xs mb-4">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading...
          </div>
        ) : preview ? (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded bg-navy/5 border border-navy/10">
            <span className="font-mono text-xs text-navy">
              <strong>{preview.totalEligible}</strong> eligible
            </span>
            <span className="text-navy/30 font-mono text-xs">&middot;</span>
            <span className="font-mono text-xs text-emerald-700">
              <strong>{preview.alreadyGenerated}</strong> generated
            </span>
            <span className="text-navy/30 font-mono text-xs">&middot;</span>
            <span className="font-mono text-xs text-amber-700">
              <strong>{preview.toGenerate}</strong> new
            </span>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex items-center gap-3 mb-4">
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={!preview || preview.toGenerate === 0}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded border font-mono text-xs font-bold uppercase tracking-wider transition-colors',
                preview && preview.toGenerate > 0
                  ? 'bg-navy/5 border-navy/15 text-navy hover:bg-navy/10'
                  : 'bg-navy/5 border-navy/10 text-navy/30 cursor-not-allowed',
              )}
            >
              <Image className="w-3.5 h-3.5" />
              Generate {preview?.toGenerate ?? 0} Portraits
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-4 py-2 rounded border border-red/30 bg-red/5 text-red font-mono text-xs font-bold uppercase tracking-wider hover:bg-red/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>

        {/* Progress bar */}
        {pregen && (isRunning || pregen.completeSummary) && (
          <div className="space-y-2">
            {pregen.total > 0 && (
              <>
                <div className="h-2 bg-navy/5 rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      'h-full rounded-full',
                      isRunning ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-navy/60">
                    {pregen.done}/{pregen.total}
                  </span>
                  {isRunning && pregen.latestPlayer && (
                    <span className="font-mono text-xs text-navy/50 truncate ml-4">
                      {pregen.latestPlayer}
                      {pregen.latestAttempts > 0 && ` — ${pregen.latestAttempts} attempt${pregen.latestAttempts > 1 ? 's' : ''}`}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Completion summary */}
            {pregen.completeSummary && (
              <div className="mt-2 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 font-mono text-xs text-emerald-700">
                Done: {pregen.completeSummary.generated} generated
                {pregen.completeSummary.failed > 0 && `, ${pregen.completeSummary.failed} failed`}
                {pregen.completeSummary.skipped > 0 && `, ${pregen.completeSummary.skipped} already existed`}
              </div>
            )}

            {/* Cancelled state */}
            {!isRunning && !pregen.completeSummary && pregen.done > 0 && (
              <div className="mt-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 font-mono text-xs text-amber-700">
                Cancelled after {pregen.generated} generated, {pregen.failed} failed
              </div>
            )}
          </div>
        )}
      </PaperCard>
    </motion.section>
  );
}
