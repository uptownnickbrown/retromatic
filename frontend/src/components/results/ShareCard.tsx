import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
import type { ResultsPick } from '../../types';

interface ShareCardProps {
  totalScore: number;
  percentile: number;
  picks: ResultsPick[];
  date: string;
}

function getScoreEmoji(score: number): string {
  if (score >= 9.0) return '\u{1F7E1}'; // yellow
  if (score >= 7.0) return '\u{1F7E2}'; // green
  if (score >= 5.0) return '\u{26AA}';  // white
  if (score >= 3.0) return '\u{1F7E0}'; // orange
  return '\u{1F534}';                    // red
}

export function ShareCard({ totalScore, percentile, picks, date }: ShareCardProps) {
  const generateShareText = useCallback(() => {
    const grid = picks.map(p => getScoreEmoji(p.legendScore)).join('');
    const lines = [
      `\u{26BE} Sandlot ${date}`,
      '',
      grid,
      '',
      `Legend Score: ${totalScore.toFixed(1)}/100`,
      `Top ${Math.max(1, 100 - Math.round(percentile))}%`,
      '',
      'playsandlot.com',
    ];
    return lines.join('\n');
  }, [totalScore, percentile, picks, date]);

  const handleShare = useCallback(async () => {
    const text = generateShareText();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User cancelled or share failed, fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
  }, [generateShareText]);

  return (
    <button
      onClick={handleShare}
      className="card-banner w-full flex items-center justify-center gap-2 py-3.5 rounded-lg text-base min-h-[48px]"
    >
      <Share2 size={18} />
      Share Results
    </button>
  );
}
