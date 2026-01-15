import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useCreateDraft } from "../hooks/useDraft";
import { useUserRank, useUserDrafts } from "../hooks/useLeaderboard";

export function Home() {
  const navigate = useNavigate();
  const createDraft = useCreateDraft();
  const { data: userRank } = useUserRank();
  const { data: userDrafts } = useUserDrafts();

  const handleStartDraft = async () => {
    const result = await createDraft.mutateAsync();
    navigate(`/draft/${result.draftId}`);
  };

  const recentDrafts = userDrafts?.drafts.slice(0, 3) || [];
  const completedDrafts = recentDrafts.filter(d => d.status === 'completed');

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream to-cardboard/20">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-6xl font-bold text-sepia mb-4">
          Retromatic
        </h1>
        <p className="font-body text-xl text-dirt max-w-2xl mx-auto mb-8">
          Draft your dream team from baseball history. Search through decades of legends,
          build your roster, and see how you stack up against thousands of other teams.
        </p>
        <Button
          size="lg"
          onClick={handleStartDraft}
          disabled={createDraft.isPending}
          className="text-lg px-8 py-6"
        >
          {createDraft.isPending ? 'Starting...' : 'Start Draft'}
        </Button>
      </div>

      {/* Stats Section */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Your Rank */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Rank</CardTitle>
              <CardDescription>Your best score placement</CardDescription>
            </CardHeader>
            <CardContent>
              {userRank?.rank ? (
                <div>
                  <div className="font-mono text-4xl font-bold text-grass">
                    #{userRank.rank}
                  </div>
                  <div className="text-sm text-dirt">
                    out of {userRank.totalTeams.toLocaleString()} teams
                  </div>
                </div>
              ) : (
                <div className="text-dirt font-body">
                  Complete a draft to get ranked!
                </div>
              )}
            </CardContent>
          </Card>

          {/* Drafts Completed */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Drafts Completed</CardTitle>
              <CardDescription>Your draft history</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-4xl font-bold text-sepia">
                {completedDrafts.length}
              </div>
              <div className="text-sm text-dirt">
                {userDrafts?.drafts.filter(d => d.status === 'in_progress').length || 0} in progress
              </div>
            </CardContent>
          </Card>

          {/* Best Score */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Best Score</CardTitle>
              <CardDescription>Your highest total</CardDescription>
            </CardHeader>
            <CardContent>
              {userRank?.bestScore ? (
                <div className="font-mono text-4xl font-bold text-gold">
                  {userRank.bestScore.toFixed(1)}
                </div>
              ) : (
                <div className="text-dirt font-body">
                  No scores yet
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* How It Works */}
      <div className="container mx-auto px-4 py-12">
        <h2 className="font-display text-3xl font-bold text-sepia text-center mb-8">
          How It Works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-sepia text-cream flex items-center justify-center text-2xl font-display font-bold mx-auto mb-4">
              1
            </div>
            <h3 className="font-display text-xl font-semibold text-pinstripe mb-2">
              Search & Draft
            </h3>
            <p className="font-body text-dirt">
              Search through decades of MLB history. Find your favorite players
              and build a 15-player roster.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-sepia text-cream flex items-center justify-center text-2xl font-display font-bold mx-auto mb-4">
              2
            </div>
            <h3 className="font-display text-xl font-semibold text-pinstripe mb-2">
              Get Scored
            </h3>
            <p className="font-body text-dirt">
              Your team is scored across 10 categories and compared against
              thousands of simulated teams.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-sepia text-cream flex items-center justify-center text-2xl font-display font-bold mx-auto mb-4">
              3
            </div>
            <h3 className="font-display text-xl font-semibold text-pinstripe mb-2">
              Compete
            </h3>
            <p className="font-body text-dirt">
              See how you rank on the leaderboard. Share your results
              and challenge friends!
            </p>
          </div>
        </div>
      </div>

      {/* Recent Drafts */}
      {recentDrafts.length > 0 && (
        <div className="container mx-auto px-4 py-12">
          <h2 className="font-display text-2xl font-bold text-sepia mb-6">
            Your Recent Drafts
          </h2>
          <div className="space-y-3">
            {recentDrafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => {
                  if (draft.status === 'completed') {
                    navigate(`/results/${draft.id}`);
                  } else {
                    navigate(`/draft/${draft.id}`);
                  }
                }}
                className="w-full bg-chalk border-2 border-cardboard rounded-lg p-4 hover:border-sepia transition-colors text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display font-semibold text-pinstripe">
                      Draft #{draft.id}
                    </div>
                    <div className="text-sm text-dirt font-body">
                      {new Date(draft.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    {draft.status === 'completed' ? (
                      <>
                        <div className="font-mono text-lg font-bold text-grass">
                          {parseFloat(draft.totalScore || '0').toFixed(1)}
                        </div>
                        <div className="text-xs text-dirt">
                          {draft.percentile}th percentile
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-gold font-body">In Progress</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={() => navigate('/history')}>
              View All Drafts
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center text-dirt/60 font-body text-sm">
        <p>Data from the Lahman Baseball Database (1961-2023)</p>
      </footer>
    </div>
  );
}
