import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Check, AlertTriangle, Search, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { streamAgentBuild, streamAgentContinue } from '../../lib/adminApi';
import { INITIAL_SESSION_STATE } from '../../lib/adminApi';
import type { AgentEvent, ProposalData, AgentSessionState, AgentChatMessage } from '../../lib/adminApi';

interface AgentChatPanelProps {
  open: boolean;
  onClose: () => void;
  // Lifted state for conversation persistence across panel open/close
  sessionState: AgentSessionState;
  onSessionStateChange: (state: AgentSessionState) => void;
}

export function AgentChatPanel({ open, onClose, sessionState, onSessionStateChange }: AgentChatPanelProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(
    sessionState.messages.length > 0
      ? Math.max(...sessionState.messages.map(m => m.id))
      : 0,
  );

  const { messages, running, awaitingFeedback, sessionId } = sessionState;

  const updateState = useCallback((partial: Partial<AgentSessionState>) => {
    onSessionStateChange({ ...sessionState, ...partial });
  }, [sessionState, onSessionStateChange]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addMessage = useCallback((msg: Omit<AgentChatMessage, 'id'>) => {
    const newMsg = { ...msg, id: ++msgIdRef.current };
    onSessionStateChange({
      ...sessionState,
      messages: [...sessionState.messages, newMsg],
    });
  }, [sessionState, onSessionStateChange]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'session':
        updateState({ sessionId: event.sessionId || null });
        break;
      case 'thinking':
      case 'message':
        addMessage({ type: 'agent', text: event.message || '' });
        break;
      case 'tool_call':
        addMessage({
          type: 'tool',
          text: `${event.tool}(${JSON.stringify(event.args).slice(0, 100)}...)`,
          toolName: event.tool,
        });
        break;
      case 'proposal':
        addMessage({
          type: 'proposal',
          text: `Proposed: "${event.proposal?.theme}"`,
          proposal: event.proposal,
        });
        break;
      case 'awaiting_feedback':
        updateState({ awaitingFeedback: true, running: false, sessionId: event.sessionId || sessionState.sessionId });
        break;
      case 'success':
        addMessage({
          type: 'success',
          text: `Challenge #${event.challengeId} created! Theme: "${event.theme}"`,
        });
        qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
        updateState({ running: false, awaitingFeedback: false, sessionId: null });
        break;
      case 'error':
        addMessage({ type: 'error', text: event.message || 'Unknown error' });
        updateState({ running: false });
        break;
      case 'error_recoverable':
        addMessage({ type: 'error', text: `Retrying: ${event.message}` });
        break;
      case 'complete':
        updateState({ running: false });
        break;
    }
  }, [addMessage, updateState, qc, sessionState.sessionId]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || running) return;
    const text = input.trim();
    setInput('');
    addMessage({ type: 'user', text });
    updateState({ running: true, awaitingFeedback: false });

    let stream: { abort: () => void };
    if (awaitingFeedback && sessionId) {
      // Continue existing conversation
      stream = streamAgentContinue(sessionId, text, handleEvent);
    } else {
      // Start new conversation
      stream = streamAgentBuild(text, handleEvent);
    }

    abortRef.current = stream;
  }, [input, running, awaitingFeedback, sessionId, addMessage, updateState, handleEvent]);

  const handleApprove = useCallback(() => {
    if (!sessionId || running) return;
    addMessage({ type: 'user', text: 'Approved, submit the challenge.' });
    updateState({ running: true, awaitingFeedback: false });
    const stream = streamAgentContinue(sessionId, 'The user approved the preview. Call submit_challenge with the same lineup.', handleEvent);
    abortRef.current = stream;
  }, [sessionId, running, addMessage, updateState, handleEvent]);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    msgIdRef.current = 0;
    onSessionStateChange(INITIAL_SESSION_STATE);
  }, [onSessionStateChange]);

  const handleClose = () => {
    // Don't clear state — just hide the panel
    if (running) {
      abortRef.current?.abort();
      updateState({ running: false });
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
                  <span className="font-mono text-[10px] text-muted">Thinking...</span>
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
                  placeholder={awaitingFeedback ? 'Suggest changes or type to approve...' : 'Describe a challenge...'}
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
      <div className="flex items-center gap-1.5 py-0.5">
        <Search className="w-3 h-3 text-muted/40 flex-shrink-0" />
        <span className="font-mono text-[9px] text-muted/60 truncate">{message.text}</span>
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

  // Count curated vs auto-filled rounds
  const curatedCount = proposal.rounds.filter(r => !r.autoFilled).length;
  const autoFilledCount = proposal.rounds.filter(r => r.autoFilled).length;

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
        <span className="font-mono text-[10px] text-muted">
          {curatedCount} curated, {autoFilledCount} auto
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
                round.autoFilled ? 'text-muted/50 bg-navy/5' : 'text-navy bg-navy/10'
              }`}>
                {round.position}
              </span>

              {/* Players */}
              <div className="flex-1 min-w-0 space-y-0.5">
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Auto-fill note */}
      {autoFilledCount > 0 && expanded && (
        <div className="px-3 py-1.5 bg-amber-500/5 border-t border-navy/5">
          <p className="font-mono text-[10px] text-amber-700">
            {autoFilledCount} position{autoFilledCount > 1 ? 's' : ''} will be auto-filled with random eligible players
          </p>
        </div>
      )}

      {/* Approve button */}
      {isActive && (
        <div className="px-3 py-2.5 border-t border-navy/10">
          <button
            onClick={onApprove}
            className="w-full py-2 rounded bg-emerald-600 text-white font-mono text-xs font-bold
                       hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
          >
            <Check className="w-3.5 h-3.5" />
            Approve & Submit
          </button>
        </div>
      )}
    </div>
  );
}
