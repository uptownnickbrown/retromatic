import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDraftResults } from "../hooks/useDraft";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { StarRating } from "../components/ui/star-rating";
import { getOrdinalSuffix, formatNumber } from "../lib/utils";
import {
  ALL_CATEGORIES,
  getCategoryLabel,
  formatCategoryValue,
  isInvertedCategory,
  type Category,
} from "../types";

export function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const draftId = id ? parseInt(id) : null;

  const { data, isLoading, error } = useDraftResults(draftId);
  const [revealStep, setRevealStep] = React.useState(0);
  const [isRevealing, setIsRevealing] = React.useState(true);

  // Auto-advance reveal animation
  React.useEffect(() => {
    if (!isRevealing || !data) return;

    const totalSteps = ALL_CATEGORIES.length + 3; // categories + summary + roto + commentary
    if (revealStep >= totalSteps) {
      setIsRevealing(false);
      return;
    }

    const timer = setTimeout(() => {
      setRevealStep(prev => prev + 1);
    }, revealStep === 0 ? 500 : 800);

    return () => clearTimeout(timer);
  }, [revealStep, isRevealing, data]);

  const skipReveal = () => {
    setRevealStep(ALL_CATEGORIES.length + 3);
    setIsRevealing(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-gold border-t-transparent rounded-full mx-auto mb-4" />
          <div className="font-body text-cream/60">Loading results...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <div className="text-red mb-4">
              {error?.message || 'Results not found'}
            </div>
            <Button onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { draft, roster } = data;
  const categoryScores = draft.categoryScores || {};

  return (
    <div className="min-h-screen bg-navy">
      {/* Header */}
      <header className="bg-navy-light border-b border-cream/10 py-4 px-4">
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="font-display text-xl font-bold text-cream hover:text-gold transition-colors">
            RETRO<span className="text-gold">MATIC</span>
          </button>
          <div className="flex items-center gap-4">
            {isRevealing && (
              <Button variant="ghost" onClick={skipReveal} className="text-cream/60 hover:text-cream">
                Skip Animation
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/')}>
              New Draft
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Overall Score - Always visible */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="font-display text-4xl font-bold text-cream mb-2">
            Draft Complete!
          </h1>
          <div className="font-mono text-7xl font-bold text-gold mb-2 scoreboard-text">
            {parseFloat(draft.totalScore || '0').toFixed(1)}
          </div>
          <div className="text-xl text-cream/70 font-body">
            {getOrdinalSuffix(draft.percentile || 50)} Percentile
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Category Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {ALL_CATEGORIES.map((category, index) => {
                  const value = categoryScores[category] || 0;
                  const isVisible = revealStep > index;
                  const isInverted = isInvertedCategory(category);

                  return (
                    <AnimatePresence key={category}>
                      {isVisible && (
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center justify-between p-3 bg-navy rounded-lg border border-cream/10"
                        >
                          <div>
                            <div className="font-display font-semibold text-cream">
                              {getCategoryLabel(category)}
                            </div>
                            <div className="text-sm text-cream/50">
                              {isInverted ? 'Lower is better' : 'Higher is better'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-2xl font-bold text-gold">
                              {formatCategoryValue(category as Category, value)}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Roto League Result */}
          <div className="space-y-6">
            <AnimatePresence>
              {revealStep > ALL_CATEGORIES.length && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>12-Team League Result</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center mb-4">
                        <div className="font-mono text-5xl font-bold text-grass-light scoreboard-text">
                          {getOrdinalSuffix(draft.rotoPlacement || 6)}
                        </div>
                        <div className="text-cream/60 font-body mt-1">Place Finish</div>
                      </div>
                      {draft.winLossRecord && (
                        <div className="text-center p-4 bg-navy rounded-lg border border-cream/10">
                          <div className="font-mono text-xl text-gold">
                            {draft.winLossRecord}
                          </div>
                          <div className="text-sm text-cream/50 mt-1">vs all teams in database</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Outlier Facts */}
            <AnimatePresence>
              {revealStep > ALL_CATEGORIES.length + 1 && draft.outlierFacts && draft.outlierFacts.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Notable Achievements</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-3">
                        {draft.outlierFacts.map((fact, i) => (
                          <li key={i} className="flex items-start gap-3 p-3 bg-gold/10 rounded-lg border border-gold/20">
                            <span className="text-gold text-xl">★</span>
                            <span className="font-body text-cream">{fact}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI Commentary */}
            <AnimatePresence>
              {revealStep > ALL_CATEGORIES.length + 2 && draft.aiCommentary && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="bg-gradient-to-br from-navy-light to-grass/20 border-grass/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <span>Scout's Report</span>
                        <Badge variant="outline">AI Generated</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-body text-cream italic leading-relaxed text-lg">
                        "{draft.aiCommentary}"
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Roster Display */}
        {!isRevealing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8"
          >
            <Card>
              <CardHeader>
                <CardTitle>Your Roster</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roster.map(({ rosterSlot, player }) => (
                    <div
                      key={rosterSlot}
                      className="p-4 bg-navy rounded-lg border border-cream/10 hover:border-gold/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="secondary">{rosterSlot}</Badge>
                        <StarRating rating={player.starRating} size="sm" />
                      </div>
                      <div className="font-display font-semibold text-cream">
                        {player.nameFirst} {player.nameLast}
                      </div>
                      <div className="text-sm text-cream/60 font-mono">
                        {player.year} · {player.team} · {player.position}
                      </div>
                      <div className="mt-2 text-xs text-cream/50 font-body">
                        {player.playerType === 'batter' ? (
                          <>
                            {player.stats.R} R · {player.stats.HR} HR · {player.stats.RBI} RBI ·{' '}
                            {player.stats.SB} SB · {(player.stats.AVG as number).toFixed(3)} AVG
                          </>
                        ) : (
                          <>
                            {player.stats.W} W · {player.stats.SV} SV · {player.stats.K || player.stats.SO} K ·{' '}
                            {(player.stats.ERA as number).toFixed(2)} ERA · {(player.stats.WHIP as number).toFixed(2)} WHIP
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Action Buttons */}
        {!isRevealing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 flex justify-center gap-4"
          >
            <Button onClick={() => navigate('/')} size="lg">
              Draft Again
            </Button>
            <Button variant="outline" onClick={() => navigate('/leaderboard')} size="lg" className="border-gold text-gold hover:bg-gold hover:text-navy">
              View Leaderboard
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
