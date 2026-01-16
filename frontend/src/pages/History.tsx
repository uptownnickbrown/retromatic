import * as React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-4xl font-bold text-cream mb-8"
        >
          Your Draft History
        </motion.h1>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-cream/60">Total Drafts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-4xl font-bold text-cream">
                  {completedDrafts.length}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-cream/60">Best Rank</CardTitle>
              </CardHeader>
              <CardContent>
                {rankData?.rank ? (
                  <div className="font-mono text-4xl font-bold text-grass-light">
                    #{rankData.rank}
                  </div>
                ) : (
                  <div className="text-cream/40 font-body">N/A</div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-cream/60">Best Score</CardTitle>
              </CardHeader>
              <CardContent>
                {rankData?.bestScore ? (
                  <div className="font-mono text-4xl font-bold text-gold">
                    {rankData.bestScore.toFixed(1)}
                  </div>
                ) : (
                  <div className="text-cream/40 font-body">N/A</div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {draftsLoading && (
          <div className="text-center py-12">
            <div className="animate-spin h-12 w-12 border-4 border-gold border-t-transparent rounded-full mx-auto mb-4" />
            <div className="font-body text-cream/60">Loading history...</div>
          </div>
        )}

        {/* In Progress Drafts */}
        {inProgressDrafts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-8"
          >
            <h2 className="font-display text-2xl font-semibold text-cream mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gold animate-pulse"></span>
              In Progress
            </h2>
            <div className="space-y-3">
              {inProgressDrafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => navigate(`/draft/${draft.id}`)}
                  className="w-full bg-navy-light border border-gold/30 rounded-xl p-4 hover:border-gold transition-colors text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display font-semibold text-cream group-hover:text-gold transition-colors">
                        Draft #{draft.id}
                      </div>
                      <div className="text-sm text-cream/60 font-body">
                        Started {new Date(draft.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="default">In Progress</Badge>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Completed Drafts */}
        {completedDrafts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <h2 className="font-display text-2xl font-semibold text-cream mb-4">
              Completed Drafts
            </h2>
            <div className="space-y-3">
              {completedDrafts.map((draft, index) => (
                <motion.button
                  key={draft.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                  onClick={() => navigate(`/results/${draft.id}`)}
                  className="w-full bg-navy-light border border-cream/10 rounded-xl p-4 hover:border-gold/50 transition-colors text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display font-semibold text-cream group-hover:text-gold transition-colors">
                        Draft #{draft.id}
                      </div>
                      <div className="text-sm text-cream/60 font-body">
                        Completed {new Date(draft.completedAt!).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xl font-bold text-grass-light">
                        {parseFloat(draft.totalScore || '0').toFixed(1)}
                      </div>
                      <div className="text-xs text-cream/50">
                        {draft.rotoPlacement && getOrdinalSuffix(draft.rotoPlacement)} place ·{' '}
                        {draft.percentile}th %ile
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {drafts.length === 0 && !draftsLoading && (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-cream/60 font-body mb-4">
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
