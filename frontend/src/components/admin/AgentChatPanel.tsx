import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Check, AlertTriangle, Search, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { streamAgentBuild, streamAgentContinue } from '../../lib/adminApi';
import type { AgentEvent, ProposalData, AgentSessionState, AgentChatMessage, AgentAction } from '../../lib/adminApi';

interface AgentChatPanelProps {
  open: boolean;
  onClose: () => void;
  sessionState: AgentSessionState;
  dispatch: React.Dispatch<AgentAction>;
}

function formatToolCall(tool: string, args?: Record<string, unknown>): string {
  if (tool === 'search_players') {
    const parts: string[] = [];
    if (args?.firstName) parts.push(String(args.firstName));
    if (args?.name) parts.push(String(args.name));
    if (args?.team) parts.push(String(args.team));
    if (args?.position) parts.push(String(args.position));
    if (args?.yearMin || args?.yearMax) {
      parts.push(`${args.yearMin || '...'}–${args.yearMax || '...'}`);
    }
    if (args?.statFilter) {
      const sf = args.statFilter as { stat?: string; min?: number; max?: number };
      const statParts = [sf.stat];
      if (sf.min != null) statParts.push(`≥${sf.min}`);
      if (sf.max != null) statParts.push(`≤${sf.max}`);
      parts.push(statParts.join(''));
    }
    return parts.length > 0 ? `Searching: ${parts.join(', ')}` : 'Searching players...';
  }
  if (tool === 'lookup_player') {
    const parts = [args?.firstName, args?.lastName].filter(Boolean).map(String);
    return `Looking up: ${parts.join(' ')}`;
  }
  if (tool === 'preview_challenge') return 'Building preview...';
  if (tool === 'submit_challenge') return 'Submitting challenge...';
  return tool;
}

export function AgentChatPanel({ open, onClose, sessionState, dispatch }: AgentChatPanelProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, running, awaitingFeedback, sessionId, phase, startedAt } = sessionState;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'session':
        dispatch({ type: 'SESSION', sessionId: event.sessionId || '' });
        break;
      case 'thinking':
      case 'message':
        dispatch({ type: 'AGENT_MESSAGE', text: event.message || '' });
        break;
      case 'tool_call':
        dispatch({
          type: 'TOOL_CALL',
          text: formatToolCall(event.tool || '', event.args),
          toolName: event.tool || '',
          toolArgs: event.args,
        });
        break;
      case 'proposal':
        dispatch({
          type: 'PROPOSAL',
          text: `Proposed: "${event.proposal?.theme}"`,
          proposal: event.proposal!,
        });
        break;
      case 'awaiting_feedback':
        dispatch({ type: 'AWAITING_FEEDBACK', sessionId: event.sessionId });
        break;
      case 'success':
        dispatch({
          type: 'SUCCESS',
          text: `Challenge #${event.challengeId} created! Theme: "${event.theme}"`,
        });
        qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
        break;
      case 'error':
        dispatch({ type: 'ERROR', text: event.message || 'Unknown error' });
        break;
      case 'error_recoverable':
        dispatch({ type: 'ERROR_RECOVERABLE', text: `Retrying: ${event.message}` });
        break;
      case 'complete':
        dispatch({ type: 'COMPLETE' });
        break;
    }
  }, [dispatch, qc]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || running) return;
    const text = input.trim();
    setInput('');
    dispatch({ type: 'USER_MESSAGE', text });
    dispatch({ type: 'START_RUNNING' });

    let stream: { abort: () => void };
    if (awaitingFeedback && sessionId) {
      stream = streamAgentContinue(sessionId, text, handleEvent);
    } else {
      stream = streamAgentBuild(text, handleEvent);
    }

    abortRef.current = stream;
  }, [input, running, awaitingFeedback, sessionId, dispatch, handleEvent]);

  const handleApprove = useCallback(() => {
    if (!sessionId || running) return;
    dispatch({ type: 'USER_MESSAGE', text: 'Approved, submit the challenge.' });
    dispatch({ type: 'START_RUNNING' });
    const stream = streamAgentContinue(sessionId, 'The user approved the preview. Call submit_challenge with the same lineup.', handleEvent);
    abortRef.current = stream;
  }, [sessionId, running, dispatch, handleEvent]);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  const handleClose = () => {
    if (running) {
      abortRef.current?.abort();
      dispatch({ type: 'COMPLETE' });
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-navy/20 z-40"
            onClick={handleClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-[420px] max-w-[90vw] bg-bone border-l-2 border-navy/15 z-50 flex flex-col shadow-xl"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-navy/10 flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-gold" />
              <h3 className="font-editorial font-bold text-lg text-navy flex-1">AI Builder</h3>
              {messages.length > 0 && (
                <button
                  onClick={handleNewChat}
                  className="font-mono text-[10px] text-muted hover:text-navy transition-colors px-2 py-1 rounded border border-navy/10"
                >
                  New Chat
                </button>
              )}
              <button onClick={handleClose} className="p-1.5 text-muted hover:text-navy transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="w-8 h-8 text-navy/15 mx-auto mb-3" />
                  <p className="font-mono text-xs text-muted">
                    Describe the challenge you want to build.
                  </p>
                  <p className="font-mono text-[10px] text-muted/60 mt-2">
                    e.g. "Make a challenge about 90s power hitters"
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLatestProposal={
                    msg.type === 'proposal' &&
                    awaitingFeedback &&
                    msg.id === Math.max(...messages.filter(m => m.type === 'proposal').map(m => m.id))
                  }
                  onApprove={handleApprove}
                  onNavigate={(id) => {
                    handleClose();
                    navigate(`/admin/challenge/${id}`);
                  }}
                />
              ))}

              {running && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="w-3.5 h-3.5 text-navy/40 animate-spin" />
                  <span className="font-mono text-[11px] text-muted">
                    {phase === 'searching' ? 'Searching players...'
                      : phase === 'building' ? 'Building preview...'
                        : phase === 'submitting' ? 'Submitting challenge...'
                          : 'Thinking...'}
                  </span>
                  {startedAt && <ElapsedTimer startedAt={startedAt} />}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-5 py-4 border-t border-navy/10">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder={awaitingFeedback ? 'e.g. "Swap Griffey for Bonds at OF"' : 'Describe a challenge...'}
                  disabled={running}
                  className="flex-1 px-3 py-2 font-mono text-sm bg-paper border-2 border-navy/15 rounded
                             text-navy placeholder:text-muted/40
                             focus:border-navy/30 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || running}
                  className="p-2.5 rounded bg-navy text-bone hover:bg-navy/90 disabled:opacity-30 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Elapsed Timer ──────────────────────────────────────────

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return (
    <span className="font-mono text-[10px] text-muted/40 tabular-nums ml-auto">
      {elapsed}s
    </span>
  );
}

// ─── Message Bubble ─────────────────────────────────────────

function MessageBubble({
  message,
  isLatestProposal,
  onApprove,
  onNavigate,
}: {
  message: AgentChatMessage;
  isLatestProposal?: boolean;
  onApprove?: () => void;
  onNavigate: (id: number) => void;
}) {
  if (message.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-navy text-bone px-3 py-2 rounded-lg rounded-br-none max-w-[80%]">
          <p className="font-mono text-xs">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'tool') {
    return (
      <div className="flex items-start gap-2 py-1 pl-2 border-l-2 border-navy/10">
        <Search className="w-3.5 h-3.5 text-navy/30 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-navy/50">{message.text}</span>
          {message.toolArgs && message.toolName === 'search_players' && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {Object.entries(message.toolArgs)
                .filter(([, v]) => v != null)
                .map(([k, v]) => (
                  <span key={k} className="font-mono text-[10px] text-muted/60">
                    {k}: {String(v)}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.type === 'proposal' && message.proposal) {
    return <ProposalCard proposal={message.proposal} isActive={!!isLatestProposal} onApprove={onApprove} />;
  }

  if (message.type === 'success') {
    const match = message.text.match(/Challenge #(\d+)/);
    const challengeId = match ? parseInt(match[1]) : null;

    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="font-mono text-xs text-emerald-700 flex-1">{message.text}</p>
        </div>
        {challengeId && (
          <button
            onClick={() => onNavigate(challengeId)}
            className="mt-2 font-mono text-[10px] text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            View challenge →
          </button>
        )}
      </div>
    );
  }

  if (message.type === 'error') {
    return (
      <div className="flex items-start gap-2 py-1">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-red-500">{message.text}</p>
      </div>
    );
  }

  // Agent message
  return (
    <div className="bg-paper border border-navy/8 rounded-lg rounded-bl-none px-3 py-2 max-w-[90%]">
      <p className="font-mono text-xs text-navy/70 whitespace-pre-wrap">{message.text}</p>
    </div>
  );
}

// ─── Proposal Card ────────────────────────────────────────────

function ProposalCard({
  proposal,
  isActive,
  onApprove,
}: {
  proposal: ProposalData;
  isActive: boolean;
  onApprove?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const filledCount = proposal.rounds.filter(r => r.players.length > 0).length;
  const completeCount = proposal.rounds.filter(r => r.players.length === 3).length;
  const isComplete = completeCount === 10;
  const unfilledPositions = proposal.rounds.filter(r => r.players.length === 0);
  const incompletePositions = proposal.rounds.filter(r => r.players.length > 0 && r.players.length < 3);

  return (
    <div className="border-2 border-navy/15 rounded-lg overflow-hidden bg-paper">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-navy/5 border-b border-navy/10 text-left"
      >
        <Sparkles className="w-3.5 h-3.5 text-gold flex-shrink-0" />
        <span className="font-editorial font-bold text-sm text-navy flex-1 truncate">
          {proposal.theme}
        </span>
        <span className={`font-mono text-[10px] ${isComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
          {filledCount} of 10 filled
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted" /> : <ChevronDown className="w-3 h-3 text-muted" />}
      </button>

      {/* Rounds list */}
      {expanded && (
        <div className="px-3 py-2 space-y-1.5 max-h-[300px] overflow-y-auto">
          {proposal.rounds.map((round) => (
            <div key={round.position} className="flex items-start gap-2">
              {/* Position badge */}
              <span className={`font-mono text-[10px] font-bold w-8 flex-shrink-0 text-center py-0.5 rounded ${
                round.players.length === 0 ? 'text-muted/40 bg-navy/5' :
                round.players.length < 3 ? 'text-amber-600 bg-amber-500/10' :
                'text-navy bg-navy/10'
              }`}>
                {round.position}
              </span>

              {/* Players or unfilled indicator */}
              <div className="flex-1 min-w-0 space-y-0.5">
                {round.players.length === 0 ? (
                  <span className="font-mono text-[11px] text-muted/40 italic">(unfilled)</span>
                ) : (
                  <>
                    {round.players.map((player) => {
                      const bestYear = player.years.reduce((best, y) =>
                        y.sandlotScore > best.sandlotScore ? y : best
                      , player.years[0]);

                      return (
                        <div key={player.playerId} className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-navy truncate flex-1">
                            {player.playerName}
                          </span>
                          <span className="font-mono text-[10px] text-muted">
                            {player.years.map(y => y.year).join(', ')}
                          </span>
                          <span className={`font-mono text-[10px] font-bold tabular-nums ${
                            bestYear.sandlotScore >= 8 ? 'text-emerald-600'
                              : bestYear.sandlotScore >= 6 ? 'text-navy'
                                : 'text-muted'
                          }`}>
                            {bestYear.sandlotScore.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                    {round.players.length < 3 && (
                      <span className="font-mono text-[10px] text-amber-600 italic">
                        need {3 - round.players.length} more player{round.players.length < 2 ? 's' : ''}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gaps note */}
      {(unfilledPositions.length > 0 || incompletePositions.length > 0) && expanded && (
        <div className="px-3 py-1.5 bg-amber-500/5 border-t border-navy/5">
          <p className="font-mono text-[10px] text-amber-700">
            {unfilledPositions.length > 0 && `${unfilledPositions.length} position${unfilledPositions.length > 1 ? 's' : ''} unfilled`}
            {unfilledPositions.length > 0 && incompletePositions.length > 0 && ', '}
            {incompletePositions.length > 0 && `${incompletePositions.length} incomplete`}
            {' — tell the builder what to do with them'}
          </p>
        </div>
      )}

      {/* Approve button + edit hint */}
      {isActive && (
        <div className="px-3 py-2.5 border-t border-navy/10">
          {isComplete ? (
            <button
              onClick={onApprove}
              className="w-full py-2 rounded bg-emerald-600 text-white font-mono text-xs font-bold
                         hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
            >
              <Check className="w-3.5 h-3.5" />
              Approve & Submit
            </button>
          ) : (
            <div className="text-center py-1">
              <p className="font-mono text-[10px] text-amber-700 font-bold">
                {10 - completeCount} position{10 - completeCount > 1 ? 's' : ''} still need players
              </p>
            </div>
          )}
          <p className="font-mono text-[10px] text-muted/50 mt-2 text-center">
            Or type below to request changes (swap players, adjust years, etc.)
          </p>
        </div>
      )}
    </div>
  );
}
