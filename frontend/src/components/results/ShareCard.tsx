import { useState, useCallback } from 'react';
import { Share2, Copy, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ResultsPick } from '../../types';
import { safeNum } from '../../lib/numeric';
import { VintageButton } from '../ui/VintageButton';

interface ShareCardProps {
  totalScore: number;
  percentile: number;
  picks: ResultsPick[];
  date: string;
}

function getScoreEmoji(score: number): string {
  if (score >= 9.5) return '\u{1F7E1}'; // gold — legendary
  if (score >= 6.0) return '\u{26AA}';  // white — great
  return '\u{26AB}';                     // black — average
}

export function ShareCard({ totalScore, percentile, picks, date }: ShareCardProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateShareText = useCallback(() => {
    const grid = picks.map(p => getScoreEmoji(safeNum(p.legendScore))).join('');
    const lines = [
      `\u{26BE} Sandlot ${date}`,
      '',
      grid,
      '',
      `Legend Score: ${safeNum(totalScore).toFixed(1)}/100`,
      `Top ${Math.max(1, 100 - Math.round(safeNum(percentile)))}%`,
      '',
      'playsandlot.com',
    ];
    return lines.join('\n');
  }, [totalScore, percentile, picks, date]);

  const handleCopy = useCallback(async () => {
    const text = generateShareText();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generateShareText]);

  const handleNativeShare = useCallback(async () => {
    const text = generateShareText();
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // User cancelled
      }
    }
  }, [generateShareText]);

  return (
    <>
      <VintageButton
        variant="ticket"
        onClick={() => setShowPreview(true)}
        className="w-full flex items-center justify-center gap-2 text-base"
      >
        <Share2 size={18} />
        Share Results
      </VintageButton>

      {/* Share preview modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-navy/40"
            onClick={() => setShowPreview(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="paper-card p-5 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setShowPreview(false)}
                className="absolute top-3 right-3 text-muted hover:text-navy transition-colors p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>

              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted mb-3">
                Share Preview
              </p>

              {/* Preview box */}
              <pre className="bg-[#ECE9E0] rounded p-3 mb-4 text-sm font-mono text-navy whitespace-pre-wrap leading-relaxed border border-navy/8">
                {generateShareText()}
              </pre>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 btn-section flex items-center justify-center gap-2"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                {typeof navigator.share === 'function' && (
                  <button
                    onClick={handleNativeShare}
                    className="flex-1 btn-ticket flex items-center justify-center gap-2"
                  >
                    <Share2 size={16} />
                    Share...
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
