import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Image, Loader2, RefreshCw, Check, RotateCcw, ImageOff } from 'lucide-react';
import { PaperCard } from '../ui/PaperCard';
import {
  streamAuditPortraits,
  streamRegeneratePortraits,
  validatePortrait,
  regenerateOptionPortrait,
} from '../../lib/adminApi';
import type { AuditStreamEvent, RegenStreamEvent } from '../../lib/adminApi';
import { cn } from '../../lib/utils';

interface AuditResult {
  optionId: number | null;
  playerId: string;
  playerName: string;
  pass: boolean;
  missing?: boolean;
  reason: string;
}

interface AuditState {
  running: boolean;
  done: number;
  total: number;
  totalOnDisk: number;
  skipped: number;
  results: AuditResult[];
}

interface RegenState {
  running: boolean;
  done: number;
  total: number;
}

export function PortraitHealthPanel() {
  const [audit, setAudit] = useState<AuditState | null>(null);
  const [regen, setRegen] = useState<RegenState | null>(null);
  const [regeneratingSet, setRegeneratingSet] = useState<Set<number>>(new Set());
  const [validatingSet, setValidatingSet] = useState<Set<string>>(new Set());
  // version map for cache-busting portrait images after regen
  const [versions, setVersions] = useState<Record<string, number>>({});

  const auditAbortRef = useRef<{ abort: () => void } | null>(null);
  const regenAbortRef = useRef<{ abort: () => void } | null>(null);

  const startAudit = useCallback((force: boolean) => {
    if (audit?.running) return;

    setAudit({ running: true, done: 0, total: 0, totalOnDisk: 0, skipped: 0, results: [] });

    const stream = streamAuditPortraits((event: AuditStreamEvent) => {
      if (event.type === 'start') {
        setAudit(prev => prev ? {
          ...prev,
          total: event.total ?? 0,
          totalOnDisk: event.totalOnDisk ?? 0,
          skipped: event.skipped ?? 0,
        } : prev);
      } else if (event.type === 'progress') {
        setAudit(prev => {
          if (!prev) return prev;
          const result: AuditResult = {
            optionId: event.optionId ?? null,
            playerId: event.playerId!,
            playerName: event.playerName!,
            pass: event.pass!,
            missing: event.missing,
            reason: event.reason!,
          };
          return {
            ...prev,
            done: event.index ?? prev.done + 1,
            results: [...prev.results, result],
          };
        });
      } else if (event.type === 'complete' || event.type === 'error') {
        setAudit(prev => {
          if (!prev) return prev;
          // Sort: failures first, then missing, then passed
          const sortKey = (r: AuditResult) => r.pass ? 2 : r.missing ? 1 : 0;
          const sorted = [...prev.results].sort((a, b) => sortKey(a) - sortKey(b));
          return { ...prev, running: false, results: sorted };
        });
        auditAbortRef.current = null;
      }
    }, { force });
    auditAbortRef.current = stream;
  }, [audit?.running]);

  const handleAudit = useCallback(() => startAudit(false), [startAudit]);
  const handleFullReaudit = useCallback(() => startAudit(true), [startAudit]);

  const handleBulkRegen = useCallback(() => {
    if (!audit || regen?.running) return;

    const failedWithOption = audit.results.filter(r => !r.pass && r.optionId != null);
    if (failedWithOption.length === 0) return;

    const failedIds = failedWithOption.map(r => r.optionId!);
    setRegen({ running: true, done: 0, total: failedIds.length });

    const stream = streamRegeneratePortraits(failedIds, (event: RegenStreamEvent) => {
      if (event.type === 'start') {
        setRegen(prev => prev ? { ...prev, total: event.total ?? failedIds.length } : prev);
      } else if (event.type === 'progress') {
        setRegen(prev => prev ? { ...prev, done: event.index ?? prev.done + 1 } : prev);

        // Update audit result in-place if regen succeeded
        if (event.pass && event.playerId) {
          setAudit(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              results: prev.results.map(r =>
                r.playerId === event.playerId
                  ? { ...r, pass: true, reason: 'Regenerated successfully' }
                  : r,
              ),
            };
          });
          setVersions(prev => ({ ...prev, [event.playerId!]: (prev[event.playerId!] ?? 0) + 1 }));
        }
      } else if (event.type === 'complete' || event.type === 'error') {
        setRegen(prev => prev ? { ...prev, running: false } : prev);
        regenAbortRef.current = null;
      }
    });
    regenAbortRef.current = stream;
  }, [audit, regen?.running]);

  const handleValidate = useCallback(async (playerId: string) => {
    setValidatingSet(prev => new Set(prev).add(playerId));
    try {
      await validatePortrait(playerId, true);
      // Flip result to pass locally
      setAudit(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          results: prev.results.map(r =>
            r.playerId === playerId ? { ...r, pass: true, reason: 'Manually validated' } : r,
          ),
        };
      });
    } finally {
      setValidatingSet(prev => {
        const next = new Set(prev);
        next.delete(playerId);
        return next;
      });
    }
  }, []);

  const handleSingleRegen = useCallback(async (optionId: number, playerId: string) => {
    setRegeneratingSet(prev => new Set(prev).add(optionId));
    try {
      const result = await regenerateOptionPortrait(optionId);
      if (result.generated) {
        setAudit(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            results: prev.results.map(r =>
              r.playerId === playerId ? { ...r, pass: true, reason: 'Regenerated successfully' } : r,
            ),
          };
        });
        setVersions(prev => ({ ...prev, [playerId]: (prev[playerId] ?? 0) + 1 }));
      }
    } finally {
      setRegeneratingSet(prev => {
        const next = new Set(prev);
        next.delete(optionId);
        return next;
      });
    }
  }, []);

  const failedCount = audit?.results.filter(r => !r.pass && !r.missing).length ?? 0;
  const missingCount = audit?.results.filter(r => r.missing).length ?? 0;
  const passedCount = audit?.results.filter(r => r.pass).length ?? 0;
  const regenableFailedCount = audit?.results.filter(r => !r.pass && r.optionId != null).length ?? 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
    >
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 className="font-editorial font-bold text-xl text-navy">Portrait Health</h2>
        <button
          onClick={handleAudit}
          disabled={audit?.running}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
            audit?.running
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
              : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy',
          )}
        >
          {audit?.running ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Auditing {audit.done}/{audit.total}...</>
          ) : (
            <><Image className="w-3 h-3" /> Audit New Portraits</>
          )}
        </button>
        <button
          onClick={handleFullReaudit}
          disabled={audit?.running}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
            audit?.running
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
              : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy',
          )}
        >
          <RotateCcw className="w-3 h-3" /> Re-audit All
        </button>
      </div>

      {/* Progress bar during audit */}
      {audit?.running && audit.total > 0 && (
        <div className="mb-3">
          <div className="h-1.5 bg-navy/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-amber-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(audit.done / audit.total) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="font-mono text-[10px] text-muted mt-1">
            Auditing {audit.done}/{audit.total}
            {audit.totalOnDisk > 0 && ` of ${audit.totalOnDisk} portraits on disk`}
            {audit.skipped > 0 && ` (${audit.skipped} skipped)`}
          </p>
        </div>
      )}

      {/* Results */}
      {audit && !audit.running && audit.results.length > 0 && (
        <PaperCard noPadding>
          {failedCount === 0 && missingCount === 0 ? (
            <div className="px-4 py-3 font-mono text-xs text-emerald-700">
              All {passedCount} portrait{passedCount !== 1 ? 's' : ''} passed
              {audit.skipped > 0 && ` (${audit.skipped} skipped)`}
              {audit.totalOnDisk > 0 && ` — ${audit.totalOnDisk} total on disk`}.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 flex items-center justify-between border-b border-navy/8">
                <span className="font-mono text-xs text-navy/70">
                  {failedCount} failed / {passedCount} passed
                  {missingCount > 0 && ` / ${missingCount} missing`}
                  {audit.skipped > 0 && ` / ${audit.skipped} skipped`}
                </span>
                {regenableFailedCount > 0 && (
                  <button
                    onClick={handleBulkRegen}
                    disabled={regen?.running}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                      regen?.running
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                        : 'bg-navy/5 border-navy/15 text-navy/60 hover:bg-navy/10 hover:text-navy',
                    )}
                  >
                    {regen?.running ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Regenerating {regen.done}/{regen.total}...</>
                    ) : (
                      <><RefreshCw className="w-3 h-3" /> Regenerate All Failed</>
                    )}
                  </button>
                )}
              </div>

              {/* Bulk regen progress bar */}
              {regen?.running && regen.total > 0 && (
                <div className="px-4 py-2 border-b border-navy/8">
                  <div className="h-1.5 bg-navy/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-emerald-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(regen.done / regen.total) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <p className="font-mono text-[10px] text-muted mt-1">
                    Regenerating {regen.done}/{regen.total}...
                  </p>
                </div>
              )}

              <div className="divide-y divide-navy/5 max-h-[500px] overflow-y-auto">
                {audit.results.map((r) => (
                  <div key={r.playerId} className="px-4 py-2.5 flex items-center gap-3">
                    {/* Status dot */}
                    <div className={cn(
                      'w-2.5 h-2.5 rounded-full flex-shrink-0',
                      r.pass ? 'bg-emerald-500' : r.missing ? 'bg-gray-400' : 'bg-red-500',
                    )} />

                    {/* Portrait — enlarged */}
                    <div className="w-20 h-24 rounded overflow-hidden bg-bone flex-shrink-0 border border-navy/10">
                      {r.missing ? (
                        <div className="w-full h-full flex items-center justify-center bg-navy/5">
                          <ImageOff className="w-6 h-6 text-navy/20" />
                        </div>
                      ) : (
                        <img
                          src={`/portraits/${r.playerId}.webp?v=${versions[r.playerId] ?? 0}`}
                          alt={r.playerName}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-navy font-bold block truncate">
                        {r.playerName}
                      </span>
                      <span className="font-mono text-[10px] text-muted block truncate">
                        {r.reason}
                      </span>
                    </div>

                    {/* Per-row actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Mark OK — only for failed portraits */}
                      {!r.pass && (
                        <button
                          onClick={() => handleValidate(r.playerId)}
                          disabled={validatingSet.has(r.playerId)}
                          className="p-1.5 rounded text-emerald-600/50 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                          title="Mark as OK"
                        >
                          {validatingSet.has(r.playerId) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </button>
                      )}

                      {/* Regenerate single — only if we have an optionId */}
                      {r.optionId != null && (
                        <button
                          onClick={() => handleSingleRegen(r.optionId!, r.playerId)}
                          disabled={regeneratingSet.has(r.optionId)}
                          className="p-1.5 rounded text-navy/40 hover:text-navy hover:bg-navy/5 transition-colors"
                          title="Regenerate portrait"
                        >
                          {regeneratingSet.has(r.optionId) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </PaperCard>
      )}

      {/* Audit completed with zero results (all skipped) */}
      {audit && !audit.running && audit.results.length === 0 && audit.total === 0 && (
        <PaperCard noPadding>
          <div className="px-4 py-3 font-mono text-xs text-muted">
            No portraits to audit{audit.skipped > 0 ? ` (${audit.skipped} already validated)` : ''}
            {audit.totalOnDisk > 0 && ` — ${audit.totalOnDisk} total on disk`}.
          </div>
        </PaperCard>
      )}
    </motion.section>
  );
}
