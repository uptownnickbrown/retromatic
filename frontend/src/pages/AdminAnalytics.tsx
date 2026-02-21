import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useHistoryStats } from '../hooks/useAdmin';
import { PaperCard } from '../components/ui/PaperCard';
import { CalendarHeatmap } from '../components/admin/CalendarHeatmap';
import { cn } from '../lib/utils';

const PERIOD_OPTIONS = [30, 60, 90] as const;

export function AdminAnalytics() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<number>(30);
  const { data, isLoading } = useHistoryStats(period);

  const stats = data?.stats ?? [];

  // Reverse for chronological order in charts (API returns newest first)
  const chartData = [...stats].reverse().map(s => ({
    ...s,
    dateLabel: new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  // Heatmap data
  const heatmapData = stats.map(s => ({
    date: s.date!,
    value: s.completions,
    challengeId: s.challengeId,
  }));

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <Loader2 className="w-6 h-6 text-navy" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-8">
      {/* Back link */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <button
          onClick={() => navigate('/admin')}
          className="btn-ghost flex items-center gap-1 mb-6 px-0"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </button>
      </motion.div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-end justify-between mb-8"
      >
        <div>
          <h1 className="font-editorial font-black text-3xl text-navy tracking-tight leading-none">
            Analytics
          </h1>
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em] mt-1">
            Challenge Performance
          </p>
        </div>

        {/* Period selector */}
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 rounded font-mono text-[10px] font-bold uppercase tracking-wider border transition-colors',
                period === p
                  ? 'bg-navy text-bone border-navy'
                  : 'bg-transparent text-muted border-navy/15 hover:border-navy/30',
              )}
            >
              {p}d
            </button>
          ))}
        </div>
      </motion.div>

      {stats.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted font-mono text-sm">No completed challenges in this period.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Calendar Heatmap */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <PaperCard>
              <h3 className="font-mono text-[10px] text-muted uppercase tracking-wider font-bold mb-4">
                Completion Activity
              </h3>
              <CalendarHeatmap
                data={heatmapData}
                weeks={Math.ceil(period / 7) + 1}
                onClickDate={(_, challengeId) => {
                  if (challengeId) navigate(`/admin/challenge/${challengeId}`);
                }}
              />
            </PaperCard>
          </motion.div>

          {/* Daily Completions */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <PaperCard>
              <h3 className="font-mono text-[10px] text-muted uppercase tracking-wider font-bold mb-4">
                Daily Completions
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(10,30,47,0.08)" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{
                        fontFamily: 'Space Mono',
                        fontSize: 11,
                        border: '2px solid rgba(10,30,47,0.15)',
                        borderRadius: 4,
                        background: '#f5f0e8',
                      }}
                    />
                    <Bar dataKey="completions" fill="rgba(10,30,47,0.25)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </PaperCard>
          </motion.div>

          {/* Average Score Trend */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <PaperCard>
              <h3 className="font-mono text-[10px] text-muted uppercase tracking-wider font-bold mb-4">
                Average Score Trend
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(10,30,47,0.08)" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{
                        fontFamily: 'Space Mono',
                        fontSize: 11,
                        border: '2px solid rgba(10,30,47,0.15)',
                        borderRadius: 4,
                        background: '#f5f0e8',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      stroke="#c4a35a"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#c4a35a' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </PaperCard>
          </motion.div>

          {/* Daily Unique Users */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <PaperCard>
              <h3 className="font-mono text-[10px] text-muted uppercase tracking-wider font-bold mb-4">
                Daily Unique Users
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(10,30,47,0.08)" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fontFamily: 'Space Mono', fill: '#8a9bb0' }}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{
                        fontFamily: 'Space Mono',
                        fontSize: 11,
                        border: '2px solid rgba(10,30,47,0.15)',
                        borderRadius: 4,
                        background: '#f5f0e8',
                      }}
                    />
                    <Bar dataKey="uniqueUsers" fill="rgba(16,185,129,0.35)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </PaperCard>
          </motion.div>
        </div>
      )}
    </div>
  );
}
