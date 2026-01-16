import * as React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { getOrdinalSuffix } from "../lib/utils";

type Period = 'all' | 'week' | 'month';

export function Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = React.useState<Period>('all');

  const { data, isLoading, error } = useLeaderboard(50, period);

  return (
    <div className="min-h-screen bg-navy">
      {/* Header */}
      <header className="bg-navy-light border-b border-cream/10 py-4 px-4">
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="font-display text-xl font-bold text-cream hover:text-gold transition-colors">
            RETRO<span className="text-gold">MATIC</span>
          </button>
          <Button onClick={() => navigate('/')}>
            New Draft
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-4xl font-bold text-cream"
          >
            Leaderboard
          </motion.h1>
          {/* Period Filter */}
          <div className="flex gap-2 bg-navy-light rounded-lg p-1">
            {(['all', 'month', 'week'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                  period === p
                    ? "bg-gold text-navy"
                    : "text-cream/60 hover:text-cream"
                )}
              >
                {p === 'all' ? 'All Time' : p === 'month' ? 'This Month' : 'This Week'}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin h-12 w-12 border-4 border-gold border-t-transparent rounded-full mx-auto mb-4" />
            <div className="font-body text-cream/60">Loading leaderboard...</div>
          </div>
        )}

        {error && (
          <Card className="max-w-md mx-auto">
            <CardContent className="py-8 text-center">
              <div className="text-red mb-4">
                Failed to load leaderboard
              </div>
              <Button onClick={() => window.location.reload()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* Stats */}
            <div className="mb-6 text-center text-cream/60 font-body">
              {data.totalTeams.toLocaleString()} total teams
            </div>

            {/* Leaderboard Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-cream/10 bg-navy">
                        <th className="px-4 py-4 text-left font-display font-semibold text-cream/60 text-sm uppercase tracking-wide">
                          Rank
                        </th>
                        <th className="px-4 py-4 text-left font-display font-semibold text-cream/60 text-sm uppercase tracking-wide">
                          Team
                        </th>
                        <th className="px-4 py-4 text-right font-display font-semibold text-cream/60 text-sm uppercase tracking-wide">
                          Score
                        </th>
                        <th className="px-4 py-4 text-right font-display font-semibold text-cream/60 text-sm uppercase tracking-wide">
                          Roto
                        </th>
                        <th className="px-4 py-4 text-right font-display font-semibold text-cream/60 text-sm uppercase tracking-wide hidden sm:table-cell">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaderboard.map((entry, index) => (
                        <motion.tr
                          key={entry.draftId}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className={cn(
                            "border-b border-cream/5 hover:bg-gold/10 transition-colors cursor-pointer group",
                            index < 3 && "bg-gold/5"
                          )}
                          onClick={() => navigate(`/results/${entry.draftId}`)}
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              {entry.rank <= 3 ? (
                                <div
                                  className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold",
                                    entry.rank === 1 && "bg-gold text-navy",
                                    entry.rank === 2 && "bg-gray-400 text-navy",
                                    entry.rank === 3 && "bg-amber-600 text-navy"
                                  )}
                                >
                                  {entry.rank}
                                </div>
                              ) : (
                                <span className="font-mono text-cream/60 w-8 text-center">
                                  {entry.rank}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-body text-cream group-hover:text-gold transition-colors">
                              {entry.displayName}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className="font-mono font-bold text-grass-light text-lg">
                              {entry.score.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            {entry.rotoPlacement ? (
                              <span className="font-mono text-gold">
                                {getOrdinalSuffix(entry.rotoPlacement)}
                              </span>
                            ) : (
                              <span className="text-cream/30">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right hidden sm:table-cell">
                            <span className="font-mono text-sm text-cream/50">
                              {new Date(entry.completedAt).toLocaleDateString()}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {data.leaderboard.length === 0 && (
              <div className="text-center py-12 text-cream/60 font-body">
                No completed drafts yet. Be the first!
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
