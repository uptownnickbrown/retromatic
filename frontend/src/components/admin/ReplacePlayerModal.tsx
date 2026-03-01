import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Check, AlertTriangle, Search, ArrowRightLeft, Image } from 'lucide-react';
import { streamReplacementAgent } from '../../lib/adminApi';
import type { ReplacementEvent, ReplacementSuggestion, AdminRoundOption } from '../../lib/adminApi';
import { useConfirmReplacement } from '../../hooks/useAdmin';
import { cn } from '../../lib/utils';
import { getTeamNickname } from '../../lib/teams';

interface ReplacePlayerModalProps {
  open: boolean;
  onClose: () => void;
  option: AdminRoundOption;
  position: string;
  challengeId: number;
}

interface ChatMessage {
  id: number;
  type: 'user' | 'agent' | 'tool' | 'suggestion' | 'error' | 'success';
  text: string;
  suggestion?: ReplacementSuggestion;
  streaming?: boolean;
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
    return parts.length > 0 ? `Searching: ${parts.join(', ')}` : 'Searching players...';
  }
  if (tool === 'lookup_player') {
    const parts = [args?.firstName, args?.lastName].filter(Boolean).map(String);
    return `Looking up: ${parts.join(' ')}`;
  }
  if (tool === 'suggest_replacement') return 'Preparing suggestion...';
  return tool;
}

export function ReplacePlayerModal({ open, onClose, option, position, challengeId }: ReplacePlayerModalProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [awaitingFeedback, setAwaitingFeedback] = useState(false);
  const [currentSuggestion, setCurrentSuggestion] = useState<ReplacementSuggestion | null>(null);
  const [confirming, setConfirming] = useState(false);

  const abortRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgIdRef = useRef(0);
  const prevOpenRef = useRef(open);

  const confirmMutation = useConfirmReplacement();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input when modal opens, reset state when it closes
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    prevOpenRef.current = open;
  }, [open]);

  const resetState = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setRunning(false);
    setSessionId(null);
    setAwaitingFeedback(false);
    setCurrentSuggestion(null);
    setConfirming(false);
    msgIdRef.current = 0;
    setInput('');
  }, []);

  const addMsg = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    msgIdRef.current += 1;
    const id = msgIdRef.current;
    setMessages(msgs => [...msgs, { ...msg, id }]);
  }, []);

  const handleEvent = useCallback((event: ReplacementEvent) => {
    switch (event.type) {
      case 'session':
        setSessionId(event.sessionId || null);
        break;
      case 'thinking':
      case 'message':
        addMsg({ type: 'agent', text: event.message || '' });
        break;
      case 'message_delta':
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + (event.delta || '') }];
          }
          msgIdRef.current += 1;
          return [...prev, {
            id: msgIdRef.current,
            type: 'agent',
            text: event.delta || '',
            streaming: true,
          }];
        });
        break;
      case 'tool_call':
        addMsg({ type: 'tool', text: formatToolCall(event.tool || '', event.args) });
        break;
      case 'suggestion':
        if (event.suggestion) {
          setCurrentSuggestion(event.suggestion);
          addMsg({ type: 'suggestion', text: '', suggestion: event.suggestion });
        }
        break;
      case 'awaiting_feedback':
        setAwaitingFeedback(true);
        setRunning(false);
        if (event.sessionId) setSessionId(event.sessionId);
        break;
      case 'error':
        addMsg({ type: 'error', text: event.message || 'Unknown error' });
        setRunning(false);
        break;
      case 'error_recoverable':
        addMsg({ type: 'error', text: event.message || '' });
        break;
      case 'complete':
        setRunning(false);
        // Finalize streaming
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false }];
          }
          return prev;
        });
        break;
    }
  }, [addMsg]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || running) return;
    const text = input.trim();
    setInput('');
    addMsg({ type: 'user', text });
    setRunning(true);
    setAwaitingFeedback(false);
    setCurrentSuggestion(null);

    const stream = streamReplacementAgent(option.id, text, handleEvent, sessionId || undefined);
    abortRef.current = stream;
  }, [input, running, option.id, sessionId, addMsg, handleEvent]);

  const handleConfirm = useCallback(() => {
    if (!currentSuggestion || confirming) return;
    setConfirming(true);

    confirmMutation.mutate(
      {
        optionId: option.id,
        playerId: currentSuggestion.playerId,
        playerName: currentSuggestion.playerName,
        yearOptions: currentSuggestion.years.map(y => y.year),
        challengeId,
      },
      {
        onSuccess: (result) => {
          const parts: string[] = [`Replaced with ${result.option.playerName}.`];
          parts.push(`Blurbs: ${result.blurbs.generated} generated.`);
          if (result.portrait.skipped) {
            parts.push('Portrait: existing portrait reused.');
          } else if (result.portrait.generated) {
            parts.push('Portrait: newly generated.');
          } else {
            parts.push('Portrait: generation failed (can retry from challenge detail).');
          }
          addMsg({ type: 'success', text: parts.join(' ') });
          setConfirming(false);
          setCurrentSuggestion(null);
          setAwaitingFeedback(false);
        },
        onError: (err) => {
          addMsg({ type: 'error', text: `Replacement failed: ${err.message}` });
          setConfirming(false);
        },
      },
    );
  }, [currentSuggestion, confirming, confirmMutation, option.id, challengeId, addMsg]);

  const handleClose = () => {
    resetState();
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
            className="fixed inset-0 bg-navy/30 z-40"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                       w-[480px] max-w-[90vw] max-h-[80vh]
                       bg-bone border-2 border-navy/15 rounded-lg z-50
                       flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-navy/10 flex items-center gap-3">
              <ArrowRightLeft className="w-4 h-4 text-navy/60" />
              <div className="flex-1 min-w-0">
                <h3 className="font-editorial font-bold text-base text-navy">
                  Replace Player
                </h3>
                <p className="font-mono text-[10px] text-muted truncate">
                  {option.playerName} · Slot {option.playerSlot} · {position}
                </p>
              </div>
              <button onClick={handleClose} className="p-1.5 text-muted hover:text-navy transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[200px] max-h-[50vh]">
              {messages.length === 0 && (
                <div className="text-center py-6">
                  <ArrowRightLeft className="w-6 h-6 text-navy/15 mx-auto mb-2" />
                  <p className="font-mono text-xs text-muted">
                    Describe the replacement you want.
                  </p>
                  <p className="font-mono text-[10px] text-muted/60 mt-1.5 leading-relaxed">
                    e.g. "Find me a power-hitting catcher from the 90s"
                    <br />
                    or "Replace with Ivan Rodriguez"
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {/* Suggestion confirmation card */}
              {currentSuggestion && awaitingFeedback && !confirming && !confirmMutation.isSuccess && (
                <SuggestionCard
                  suggestion={currentSuggestion}
                  onConfirm={handleConfirm}
                  confirming={confirming}
                />
              )}

              {confirming && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="w-3.5 h-3.5 text-navy/40 animate-spin" />
                  <span className="font-mono text-[11px] text-muted">
                    Replacing player & generating assets...
                  </span>
                </div>
              )}

              {running && !confirming && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="w-3.5 h-3.5 text-navy/40 animate-spin" />
                  <span className="font-mono text-[11px] text-muted">
                    Searching for replacement...
                  </span>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-5 py-3 border-t border-navy/10">
              {confirmMutation.isSuccess ? (
                <button
                  onClick={handleClose}
                  className="w-full py-2 rounded bg-emerald-600 text-white font-mono text-xs font-bold
                             hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Check className="w-3.5 h-3.5" />
                  Done — Close
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                    placeholder={
                      awaitingFeedback
                        ? 'Not right? Describe what you want instead...'
                        : 'Describe the replacement you want...'
                    }
                    disabled={running || confirming}
                    className="flex-1 px-3 py-2 font-mono text-sm bg-paper border-2 border-navy/15 rounded
                               text-navy placeholder:text-muted/40
                               focus:border-navy/30 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || running || confirming}
                    className="p-2.5 rounded bg-navy text-bone hover:bg-navy/90 disabled:opacity-30 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Message Bubble ─────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-navy text-bone px-3 py-2 rounded-lg rounded-br-none max-w-[85%]">
          <p className="font-mono text-xs">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'tool') {
    return (
      <div className="flex items-start gap-2 py-1 pl-2 border-l-2 border-navy/10">
        <Search className="w-3.5 h-3.5 text-navy/30 flex-shrink-0 mt-0.5" />
        <span className="font-mono text-[11px] text-navy/50">{message.text}</span>
      </div>
    );
  }

  if (message.type === 'suggestion' && message.suggestion) {
    // The suggestion card is rendered separately for interactivity
    return null;
  }

  if (message.type === 'success') {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="font-mono text-xs text-emerald-700">{message.text}</p>
        </div>
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

// ─── Suggestion Card ────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onConfirm,
  confirming,
}: {
  suggestion: ReplacementSuggestion;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const bestYear = suggestion.years.reduce((best, y) =>
    y.sandlotScore > best.sandlotScore ? y : best,
    suggestion.years[0],
  );

  return (
    <div className="border-2 border-navy/15 rounded-lg overflow-hidden bg-paper">
      {/* Header */}
      <div className="px-3 py-2 bg-navy/5 border-b border-navy/10">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-3.5 h-3.5 text-navy/50" />
          <span className="font-editorial font-bold text-sm text-navy flex-1">
            {suggestion.playerName}
          </span>
          <span className={cn(
            'font-mono text-xs font-bold tabular-nums',
            bestYear.sandlotScore >= 9.5 ? 'text-gold'
              : bestYear.sandlotScore >= 6.0 ? 'text-navy'
                : 'text-muted',
          )}>
            Best: {bestYear.sandlotScore.toFixed(1)}
          </span>
        </div>
        <p className="font-mono text-[10px] text-muted mt-0.5">
          {suggestion.playerId}
          {suggestion.hasExistingPortrait && (
            <span className="ml-2 text-emerald-600">
              <Image className="w-3 h-3 inline -mt-0.5" /> portrait exists
            </span>
          )}
        </p>
      </div>

      {/* Year options */}
      <div className="px-3 py-2 space-y-1">
        {suggestion.years.map(ys => (
          <div key={ys.year} className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-navy w-10">{ys.year}</span>
            <span className="font-mono text-[10px] text-muted w-20 truncate">
              {ys.team ? getTeamNickname(ys.team) : '—'}
            </span>
            <span className={cn(
              'font-mono text-xs font-bold tabular-nums',
              ys.sandlotScore >= 9.5 ? 'text-gold'
                : ys.sandlotScore >= 6.0 ? 'text-navy'
                  : 'text-muted',
            )}>
              {ys.sandlotScore.toFixed(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Reasoning */}
      <div className="px-3 py-2 border-t border-navy/5">
        <p className="font-mono text-[10px] text-navy/60 italic leading-relaxed">
          {suggestion.reasoning}
        </p>
      </div>

      {/* Confirm button */}
      <div className="px-3 py-2.5 border-t border-navy/10">
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="w-full py-2 rounded bg-emerald-600 text-white font-mono text-xs font-bold
                     hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2
                     disabled:opacity-50"
        >
          {confirming ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Replacing...
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              Confirm Replacement
            </>
          )}
        </button>
        <p className="font-mono text-[10px] text-muted/50 mt-1.5 text-center">
          Will generate blurbs{suggestion.hasExistingPortrait ? '' : ' + portrait'} automatically
        </p>
      </div>
    </div>
  );
}
