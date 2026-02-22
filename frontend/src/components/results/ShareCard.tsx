import { useState, useCallback, useRef } from 'react';
import { Share2, Copy, Check, X, Download, Image, Type } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ResultsPick } from '../../types';
import { safeNum } from '../../lib/numeric';
import { generateShareImage } from '../../lib/shareImage';
import { VintageButton } from '../ui/VintageButton';

interface ShareCardProps {
  totalScore: number;
  percentile: number;
  picks: ResultsPick[];
  date: string;
}

function getScoreEmoji(score: number): string {
  if (score >= 9.5) return '\u{1F3C6}';  // 🏆 trophy
  if (score >= 6.0) return '\u{26BE}';   // ⚾ baseball
  return '\u{1F95C}';                    // 🥜 peanut
}

type Tab = 'image' | 'text';

export function ShareCard({ totalScore, percentile, picks, date }: ShareCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [tab, setTab] = useState<Tab>('image');
  const [copied, setCopied] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const generatedRef = useRef(false);

  const ensureImage = useCallback(async () => {
    if (generatedRef.current || imageUrl) return;
    generatedRef.current = true;
    setGenerating(true);
    try {
      const blob = await generateShareImage({ totalScore, percentile, picks, date });
      setImageBlob(blob);
      setImageUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('Share image generation failed:', err);
      generatedRef.current = false; // allow retry
    } finally {
      setGenerating(false);
    }
  }, [imageUrl, totalScore, percentile, picks, date]);

  const handleOpen = useCallback(() => {
    setShowModal(true);
    ensureImage();
  }, [ensureImage]);

  const generateShareText = useCallback(() => {
    const grid = picks.map(p => getScoreEmoji(safeNum(p.legendScore))).join('');
    const legendCount = picks.filter(p => safeNum(p.legendScore) >= 9.5).length;
    const lines = [
      `\u{26BE} Sandlot ${date}`,
      '',
      grid,
      '',
      `Sandlot Score: ${safeNum(totalScore).toFixed(1)}/100`,
      ...(legendCount > 0 ? [`\u{1F3C6} ${legendCount} Sandlot Legend${legendCount > 1 ? 's' : ''}`] : []),
      `Better than ${Math.max(1, Math.round(safeNum(percentile)))}% of drafts`,
      '',
      'sandlot.uptownnickbrown.com',
    ];
    return lines.join('\n');
  }, [totalScore, percentile, picks, date]);

  const handleCopyText = useCallback(async () => {
    await navigator.clipboard.writeText(generateShareText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generateShareText]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `sandlot-${date}.png`;
    a.click();
  }, [imageUrl, date]);

  const handleShare = useCallback(async () => {
    if (!navigator.share) return;
    try {
      if (tab === 'image' && imageBlob) {
        const file = new File([imageBlob], `sandlot-${date}.png`, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      }
      await navigator.share({ text: generateShareText() });
    } catch {
      // User cancelled
    }
  }, [tab, imageBlob, date, generateShareText]);

  return (
    <>
      <VintageButton
        variant="ticket"
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-2 text-base"
      >
        <Share2 size={18} />
        Share Results
      </VintageButton>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-navy/40"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="paper-card w-full max-w-md sm:rounded-lg rounded-t-xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                  Share
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-muted hover:text-navy transition-colors p-1 -mr-1"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex mx-4 mb-3 border border-navy/12 rounded overflow-hidden">
                <button
                  onClick={() => { setTab('image'); ensureImage(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
                    tab === 'image'
                      ? 'bg-navy text-paper'
                      : 'bg-paper text-muted hover:text-navy'
                  }`}
                >
                  <Image size={14} />
                  Image
                </button>
                <button
                  onClick={() => setTab('text')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
                    tab === 'text'
                      ? 'bg-navy text-paper'
                      : 'bg-paper text-muted hover:text-navy'
                  }`}
                >
                  <Type size={14} />
                  Text
                </button>
              </div>

              {/* Tab content */}
              <div className="px-4 pb-2">
                {tab === 'image' ? (
                  <div className="bg-bone rounded border border-navy/8 overflow-hidden mb-3">
                    {generating ? (
                      <div className="flex items-center justify-center py-16">
                        <div className="w-5 h-5 border-2 border-navy border-t-transparent rounded-full animate-spin" />
                        <span className="ml-2 text-xs font-mono text-muted">Generating...</span>
                      </div>
                    ) : imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Share card preview"
                        className="w-full h-auto block"
                      />
                    ) : (
                      <div className="flex items-center justify-center py-16 text-xs font-mono text-muted">
                        Failed to generate image
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="bg-bone rounded p-3 mb-3 text-sm font-mono text-navy whitespace-pre-wrap leading-relaxed border border-navy/8">
                    {generateShareText()}
                  </pre>
                )}
              </div>

              {/* Actions */}
              <div className="px-4 pb-4 flex gap-2">
                {tab === 'image' ? (
                  typeof navigator.share === 'function' ? (
                    <button
                      onClick={handleShare}
                      disabled={!imageUrl}
                      className="flex-1 btn-ticket flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <Share2 size={15} />
                      Share
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      disabled={!imageUrl}
                      className="flex-1 btn-ticket flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <Download size={15} />
                      Save
                    </button>
                  )
                ) : (
                  <>
                    <button
                      onClick={handleCopyText}
                      className="flex-1 btn-section flex items-center justify-center gap-2"
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    {typeof navigator.share === 'function' && (
                      <button
                        onClick={handleShare}
                        className="flex-1 btn-ticket flex items-center justify-center gap-2"
                      >
                        <Share2 size={15} />
                        Share
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
