import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useUserDrafts, useUserRank } from "../hooks/useLeaderboard";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { getOrdinalSuffix } from "../lib/utils";

export function History() {
  const navigate = useNavigate();
  const { data: draftsData, isLoading: draftsLoading } = useUserDrafts();
  const { data: rankData } = useUserRank();

  const drafts = draftsData?.drafts || [];
  const completedDrafts = drafts.filter(d => d.status === 'completed');
  const inProgressDrafts = drafts.filter(d => d.status === 'in_progress');

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
        <h1 className="font-display text-4xl font-bold text-sepia mb-8">
          Your Draft History
        </h1>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Total Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-4xl font-bold text-sepia">
                {completedDrafts.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Best Rank</CardTitle>
            </CardHeader>
            <CardContent>
              {rankData?.rank ? (
                <div className="font-mono text-4xl font-bold text-grass">
                  #{rankData.rank}
                </div>
              ) : (
                <div className="text-dirt font-body">N/A</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Best Score</CardTitle>
            </CardHeader>
            <CardContent>
              {rankData?.bestScore ? (
                <div className="font-mono text-4xl font-bold text-gold">
                  {rankData.bestScore.toFixed(1)}
                </div>
              ) : (
                <div className="text-dirt font-body">N/A</div>
              )}
            </CardContent>
          </Card>
        </div>

        {draftsLoading && (
          <div className="text-center py-12">
            <div className="animate-spin h-12 w-12 border-4 border-sepia border-t-transparent rounded-full mx-auto mb-4" />
            <div className="font-body text-dirt">Loading history...</div>
          </div>
        )}

        {/* In Progress Drafts */}
        {inProgressDrafts.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display text-2xl font-semibold text-sepia mb-4">
              In Progress
            </h2>
            <div className="space-y-3">
              {inProgressDrafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => navigate(`/draft/${draft.id}`)}
                  className="w-full bg-chalk border-2 border-gold rounded-lg p-4 hover:border-sepia transition-colors text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display font-semibold text-pinstripe">
                        Draft #{draft.id}
                      </div>
                      <div className="text-sm text-dirt font-body">
                        Started {new Date(draft.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="warning">In Progress</Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Completed Drafts */}
        {completedDrafts.length > 0 && (
          <div>
            <h2 className="font-display text-2xl font-semibold text-sepia mb-4">
              Completed Drafts
            </h2>
            <div className="space-y-3">
              {completedDrafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => navigate(`/results/${draft.id}`)}
                  className="w-full bg-chalk border-2 border-cardboard rounded-lg p-4 hover:border-sepia transition-colors text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display font-semibold text-pinstripe">
                        Draft #{draft.id}
                      </div>
                      <div className="text-sm text-dirt font-body">
                        Completed {new Date(draft.completedAt!).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xl font-bold text-grass">
                        {parseFloat(draft.totalScore || '0').toFixed(1)}
                      </div>
                      <div className="text-xs text-dirt">
                        {draft.rotoPlacement && getOrdinalSuffix(draft.rotoPlacement)} place ·{' '}
                        {draft.percentile}th %ile
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {drafts.length === 0 && !draftsLoading && (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-dirt font-body mb-4">
                You haven't started any drafts yet.
              </div>
              <Button onClick={() => navigate('/')}>
                Start Your First Draft
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
