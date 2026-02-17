import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
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
    <VintageButton
      variant="ticket"
      onClick={handleShare}
      className="w-full flex items-center justify-center gap-2 text-base"
    >
      <Share2 size={18} />
      Share Results
    </VintageButton>
  );
}
