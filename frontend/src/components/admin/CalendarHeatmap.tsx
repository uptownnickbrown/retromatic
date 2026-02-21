import { useMemo } from 'react';
import { cn } from '../../lib/utils';

interface HeatmapData {
  date: string;
  value: number;
  challengeId?: number;
}

interface CalendarHeatmapProps {
  data: HeatmapData[];
  weeks?: number;
  onClickDate?: (date: string, challengeId?: number) => void;
}

export function CalendarHeatmap({ data, weeks = 13, onClickDate }: CalendarHeatmapProps) {
  const { grid, months, maxValue } = useMemo(() => {
    const dataMap = new Map<string, HeatmapData>();
    for (const d of data) {
      dataMap.set(d.date, d);
    }

    // Build grid: columns = weeks, rows = days (Sun=0 to Sat=6)
    const today = new Date();
    const endDay = new Date(today);
    // Go to end of current week (Saturday)
    endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));

    const startDay = new Date(endDay);
    startDay.setDate(startDay.getDate() - (weeks * 7 - 1));

    const grid: (HeatmapData | null)[][] = [];
    const months: { label: string; col: number }[] = [];
    let lastMonth = -1;

    const cursor = new Date(startDay);
    let currentWeek: (HeatmapData | null)[] = new Array(7).fill(null);

    while (cursor <= endDay) {
      const dayOfWeek = cursor.getDay();
      const dateStr = cursor.toISOString().split('T')[0];
      const entry = dataMap.get(dateStr) || null;

      if (dayOfWeek === 0 && currentWeek.some(d => d !== null)) {
        grid.push(currentWeek);
        currentWeek = new Array(7).fill(null);
      }

      const month = cursor.getMonth();
      if (month !== lastMonth) {
        months.push({
          label: cursor.toLocaleDateString('en-US', { month: 'short' }),
          col: grid.length,
        });
        lastMonth = month;
      }

      currentWeek[dayOfWeek] = entry || { date: dateStr, value: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(currentWeek);

    const maxValue = Math.max(...data.map(d => d.value), 1);

    return { grid, months, maxValue };
  }, [data, weeks]);

  function getColor(value: number): string {
    if (value === 0) return 'bg-navy/5';
    const intensity = value / maxValue;
    if (intensity > 0.75) return 'bg-emerald-600';
    if (intensity > 0.5) return 'bg-emerald-500';
    if (intensity > 0.25) return 'bg-emerald-400';
    return 'bg-emerald-300';
  }

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  return (
    <div className="overflow-x-auto">
      {/* Month labels */}
      <div className="flex mb-1 ml-8">
        {months.map((m, i) => (
          <span
            key={i}
            className="font-mono text-[9px] text-muted"
            style={{ marginLeft: i === 0 ? `${m.col * 14}px` : undefined, width: '42px' }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-0">
        {/* Day labels */}
        <div className="flex flex-col gap-[2px] mr-1">
          {dayLabels.map((label, i) => (
            <span key={i} className="font-mono text-[8px] text-muted/60 h-[12px] leading-[12px] w-6 text-right">
              {label}
            </span>
          ))}
        </div>

        {/* Grid */}
        <div className="flex gap-[2px]">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {week.map((day, di) => (
                <div
                  key={di}
                  onClick={() => day && day.value > 0 && onClickDate?.(day.date, day.challengeId)}
                  className={cn(
                    'w-[12px] h-[12px] rounded-[2px]',
                    day ? getColor(day.value) : 'bg-transparent',
                    day && day.value > 0 && onClickDate && 'cursor-pointer hover:ring-1 hover:ring-navy/30',
                  )}
                  title={day ? `${day.date}: ${day.value} completions` : ''}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
