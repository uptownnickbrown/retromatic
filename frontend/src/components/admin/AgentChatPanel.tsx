import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Check, AlertTriangle, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { streamAgentBuild } from '../../lib/adminApi';
import type { AgentEvent } from '../../lib/adminApi';

interface AgentChatPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: number;
  type: 'user' | 'agent' | 'tool' | 'success' | 'error';
  text: string;
  toolName?: string;
}

export function AgentChatPanel({ open, onClose }: AgentChatPanelProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: ++msgIdRef.current }]);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || running) return;
    const prompt = input.trim();
    setInput('');
    addMessage({ type: 'user', text: prompt });
    setRunning(true);

    const stream = streamAgentBuild(prompt, (event: AgentEvent) => {
      switch (event.type) {
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
        case 'success':
          addMessage({
            type: 'success',
            text: `Challenge #${event.challengeId} created! Theme: "${event.theme}"`,
          });
          qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
          setRunning(false);
          break;
        case 'error':
          addMessage({ type: 'error', text: event.message || 'Unknown error' });
          setRunning(false);
          break;
        case 'error_recoverable':
          addMessage({ type: 'error', text: `Retrying: ${event.message}` });
          break;
        case 'complete':
          setRunning(false);
          break;
      }
    });

    abortRef.current = stream;
  }, [input, running, addMessage, qc]);

  const handleClose = () => {
    abortRef.current?.abort();
    setRunning(false);
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
                <MessageBubble key={msg.id} message={msg} onNavigate={(id) => {
                  handleClose();
                  navigate(`/admin/challenge/${id}`);
                }} />
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
                  placeholder="Describe a challenge..."
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
  onNavigate,
}: {
  message: ChatMessage;
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
