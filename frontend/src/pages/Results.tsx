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
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-sepia border-t-transparent rounded-full mx-auto mb-4" />
          <div className="font-body text-dirt">Loading results...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <div className="text-red-600 mb-4">
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
    <div className="min-h-screen bg-gradient-to-b from-cream to-cardboard/20">
      {/* Header */}
      <header className="bg-pinstripe text-chalk py-4 px-4">
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="font-display text-xl font-bold hover:text-gold transition-colors">
            Retromatic
          </button>
          <div className="flex items-center gap-4">
            {isRevealing && (
              <Button variant="ghost" onClick={skipReveal} className="text-chalk/70 hover:text-chalk">
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
          <h1 className="font-display text-4xl font-bold text-sepia mb-2">
            Draft Complete!
          </h1>
          <div className="font-mono text-6xl font-bold text-grass mb-2">
            {parseFloat(draft.totalScore || '0').toFixed(1)}
          </div>
          <div className="text-xl text-dirt font-body">
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
                          className="flex items-center justify-between p-3 bg-chalk rounded-lg border border-cardboard"
                        >
                          <div>
                            <div className="font-display font-semibold text-pinstripe">
                              {getCategoryLabel(category)}
                            </div>
                            <div className="text-sm text-dirt">
                              {isInverted ? 'Lower is better' : 'Higher is better'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-2xl font-bold text-sepia">
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
                        <div className="font-mono text-4xl font-bold text-grass">
                          {getOrdinalSuffix(draft.rotoPlacement || 6)}
                        </div>
                        <div className="text-dirt font-body">Place Finish</div>
                      </div>
                      {draft.winLossRecord && (
                        <div className="text-center">
                          <div className="font-mono text-lg text-sepia">
                            {draft.winLossRecord}
                          </div>
                          <div className="text-sm text-dirt">vs all teams in database</div>
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
                      <ul className="space-y-2">
                        {draft.outlierFacts.map((fact, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-gold">★</span>
                            <span className="font-body text-pinstripe">{fact}</span>
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
                  <Card className="bg-sepia/5 border-sepia">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <span>Scout's Report</span>
                        <Badge variant="outline">AI Generated</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-body text-pinstripe italic leading-relaxed">
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
        <AnimatePresence>
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
                        className="p-4 bg-chalk rounded-lg border border-cardboard"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <Badge variant="secondary">{rosterSlot}</Badge>
                          <StarRating rating={player.starRating} size="sm" />
                        </div>
                        <div className="font-display font-semibold text-pinstripe">
                          {player.nameFirst} {player.nameLast}
                        </div>
                        <div className="text-sm text-dirt font-mono">
                          {player.year} · {player.team} · {player.position}
                        </div>
                        <div className="mt-2 text-xs text-dirt/70 font-body">
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
        </AnimatePresence>

        {/* Action Buttons */}
        {!isRevealing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 flex justify-center gap-4"
          >
            <Button onClick={() => navigate('/')}>
              Draft Again
            </Button>
            <Button variant="outline" onClick={() => navigate('/leaderboard')}>
              View Leaderboard
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
