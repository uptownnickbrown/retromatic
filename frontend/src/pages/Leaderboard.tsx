import * as React from "react";
import { useNavigate } from "react-router-dom";
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
    <div className="min-h-screen bg-gradient-to-b from-cream to-cardboard/20">
      {/* Header */}
      <header className="bg-pinstripe text-chalk py-4 px-4">
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="font-display text-xl font-bold hover:text-gold transition-colors">
            Retromatic
          </button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            New Draft
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-4xl font-bold text-sepia">
            Leaderboard
          </h1>
          {/* Period Filter */}
          <div className="flex gap-2">
            {(['all', 'month', 'week'] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriod(p)}
              >
                {p === 'all' ? 'All Time' : p === 'month' ? 'This Month' : 'This Week'}
              </Button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin h-12 w-12 border-4 border-sepia border-t-transparent rounded-full mx-auto mb-4" />
            <div className="font-body text-dirt">Loading leaderboard...</div>
          </div>
        )}

        {error && (
          <Card className="max-w-md mx-auto">
            <CardContent className="py-8 text-center">
              <div className="text-red-600 mb-4">
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
            <div className="mb-6 text-center text-dirt font-body">
              {data.totalTeams.toLocaleString()} total teams
            </div>

            {/* Leaderboard Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-cardboard bg-cardboard/20">
                        <th className="px-4 py-3 text-left font-display font-semibold text-sepia">
                          Rank
                        </th>
                        <th className="px-4 py-3 text-left font-display font-semibold text-sepia">
                          Team
                        </th>
                        <th className="px-4 py-3 text-right font-display font-semibold text-sepia">
                          Score
                        </th>
                        <th className="px-4 py-3 text-right font-display font-semibold text-sepia">
                          Roto
                        </th>
                        <th className="px-4 py-3 text-right font-display font-semibold text-sepia hidden sm:table-cell">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaderboard.map((entry, index) => (
                        <tr
                          key={entry.draftId}
                          className={cn(
                            "border-b border-cardboard/50 hover:bg-cardboard/10 transition-colors cursor-pointer",
                            index < 3 && "bg-gold/5"
                          )}
                          onClick={() => navigate(`/results/${entry.draftId}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {entry.rank <= 3 ? (
                                <Badge
                                  variant={entry.rank === 1 ? 'warning' : 'secondary'}
                                  className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center",
                                    entry.rank === 1 && "bg-gold",
                                    entry.rank === 2 && "bg-gray-300",
                                    entry.rank === 3 && "bg-amber-600"
                                  )}
                                >
                                  {entry.rank}
                                </Badge>
                              ) : (
                                <span className="font-mono text-dirt w-8 text-center">
                                  {entry.rank}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-body text-pinstripe">
                              {entry.displayName}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono font-bold text-grass">
                              {entry.score.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {entry.rotoPlacement ? (
                              <span className="font-mono text-sepia">
                                {getOrdinalSuffix(entry.rotoPlacement)}
                              </span>
                            ) : (
                              <span className="text-dirt/50">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right hidden sm:table-cell">
                            <span className="font-mono text-sm text-dirt">
                              {new Date(entry.completedAt).toLocaleDateString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {data.leaderboard.length === 0 && (
              <div className="text-center py-12 text-dirt font-body">
                No completed drafts yet. Be the first!
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
