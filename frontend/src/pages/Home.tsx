import * as React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../components/ui/button";
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

  return (
    <div className="min-h-screen bg-navy">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 hero-gradient opacity-80" />

        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-gold/10 blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 4, repeat: Infinity }}
          />
          <motion.div
            className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-grass/20 blur-3xl"
            animate={{
              scale: [1.2, 1, 1.2],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 5, repeat: Infinity }}
          />
        </div>

        <div className="relative container mx-auto px-4 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-4xl mx-auto"
          >
            {/* Logo/Title */}
            <h1 className="font-display text-6xl md:text-8xl font-black text-cream mb-2 tracking-tight">
              RETRO
              <span className="text-gold">MATIC</span>
            </h1>

            <p className="text-xl md:text-2xl text-cream/80 mb-4 font-light">
              Build Your All-Time Dream Team
            </p>

            {/* Tagline */}
            <p className="text-lg text-cream/60 max-w-2xl mx-auto mb-10">
              Draft legends from 60+ years of baseball history. Compete against 10,000+ teams.
              Prove your baseball knowledge.
            </p>

            {/* CTA Button */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button
                size="lg"
                onClick={handleStartDraft}
                disabled={createDraft.isPending}
                className="text-xl px-12 py-7 bg-gold hover:bg-gold-light text-navy font-bold rounded-full pulse-glow transition-all"
              >
                {createDraft.isPending ? 'Starting...' : 'Start Draft'}
              </Button>
            </motion.div>

            {/* Quick stats */}
            <div className="mt-12 flex justify-center gap-8 md:gap-16">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center"
              >
                <div className="text-3xl md:text-4xl font-mono font-bold text-gold">34K+</div>
                <div className="text-sm text-cream/60 uppercase tracking-wide">Player Seasons</div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-center"
              >
                <div className="text-3xl md:text-4xl font-mono font-bold text-gold">1961-2023</div>
                <div className="text-sm text-cream/60 uppercase tracking-wide">Years of History</div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-center"
              >
                <div className="text-3xl md:text-4xl font-mono font-bold text-gold">10K+</div>
                <div className="text-sm text-cream/60 uppercase tracking-wide">Teams to Beat</div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-navy-light py-20">
        <div className="container mx-auto px-4">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="font-display text-4xl font-bold text-cream text-center mb-16"
          >
            How It Works
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                num: "01",
                title: "Draft Your Legends",
                desc: "Search through 60+ years of MLB history. Pick 15 players to fill your roster positions.",
                icon: "⚾"
              },
              {
                num: "02",
                title: "Stats Revealed",
                desc: "After drafting, see how your picks performed. Watch your team's stats unfold dramatically.",
                icon: "📊"
              },
              {
                num: "03",
                title: "Compete & Climb",
                desc: "Your team battles 10,000+ simulated teams. Climb the leaderboard and prove your knowledge.",
                icon: "🏆"
              }
            ].map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="relative"
              >
                <div className="premium-card rounded-2xl p-8 h-full">
                  <div className="text-5xl mb-4">{step.icon}</div>
                  <div className="text-gold font-mono text-sm mb-2">{step.num}</div>
                  <h3 className="font-display text-2xl font-bold text-cream mb-3">
                    {step.title}
                  </h3>
                  <p className="text-cream/70 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Your Stats Section */}
      {(userRank?.rank || recentDrafts.length > 0) && (
        <div className="bg-navy py-20">
          <div className="container mx-auto px-4">
            <h2 className="font-display text-3xl font-bold text-cream text-center mb-12">
              Your Record
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12">
              {/* Rank Card */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="premium-card rounded-xl p-6 text-center"
              >
                <div className="text-cream/60 text-sm uppercase tracking-wide mb-2">Best Rank</div>
                {userRank?.rank ? (
                  <div className="text-5xl font-mono font-bold text-gold">
                    #{userRank.rank}
                  </div>
                ) : (
                  <div className="text-2xl text-cream/40">—</div>
                )}
                {userRank?.totalTeams && (
                  <div className="text-sm text-cream/50 mt-1">
                    of {userRank.totalTeams.toLocaleString()}
                  </div>
                )}
              </motion.div>

              {/* Best Score Card */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="premium-card rounded-xl p-6 text-center"
              >
                <div className="text-cream/60 text-sm uppercase tracking-wide mb-2">Best Score</div>
                {userRank?.bestScore ? (
                  <div className="text-5xl font-mono font-bold text-grass-light">
                    {userRank.bestScore.toFixed(1)}
                  </div>
                ) : (
                  <div className="text-2xl text-cream/40">—</div>
                )}
              </motion.div>

              {/* Drafts Card */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="premium-card rounded-xl p-6 text-center"
              >
                <div className="text-cream/60 text-sm uppercase tracking-wide mb-2">Drafts Completed</div>
                <div className="text-5xl font-mono font-bold text-cream">
                  {recentDrafts.filter(d => d.status === 'completed').length}
                </div>
              </motion.div>
            </div>

            {/* Recent Drafts */}
            {recentDrafts.length > 0 && (
              <div className="max-w-2xl mx-auto">
                <h3 className="text-lg font-semibold text-cream/80 mb-4">Recent Drafts</h3>
                <div className="space-y-3">
                  {recentDrafts.map((draft) => (
                    <motion.button
                      key={draft.id}
                      whileHover={{ scale: 1.01, x: 4 }}
                      onClick={() => {
                        if (draft.status === 'completed') {
                          navigate(`/results/${draft.id}`);
                        } else {
                          navigate(`/draft/${draft.id}`);
                        }
                      }}
                      className="w-full premium-card rounded-lg p-4 text-left flex items-center justify-between group transition-all"
                    >
                      <div>
                        <div className="font-semibold text-cream group-hover:text-gold transition-colors">
                          Draft #{draft.id}
                        </div>
                        <div className="text-sm text-cream/50">
                          {new Date(draft.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {draft.status === 'completed' ? (
                        <div className="text-right">
                          <div className="font-mono text-xl font-bold text-grass-light">
                            {parseFloat(draft.totalScore || '0').toFixed(1)}
                          </div>
                          <div className="text-xs text-cream/50">
                            {draft.percentile}th percentile
                          </div>
                        </div>
                      ) : (
                        <span className="px-3 py-1 bg-gold/20 text-gold text-sm rounded-full">
                          In Progress
                        </span>
                      )}
                    </motion.button>
                  ))}
                </div>
                <div className="mt-6 text-center">
                  <Button
                    variant="outline"
                    onClick={() => navigate('/history')}
                    className="border-cream/30 text-cream hover:bg-cream/10"
                  >
                    View All History
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Leaderboard Teaser */}
      <div className="bg-gradient-to-b from-navy-light to-navy py-20">
        <div className="container mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl font-bold text-cream mb-4">
              Think You Know Baseball?
            </h2>
            <p className="text-cream/60 mb-8 max-w-xl mx-auto">
              The best GMs have assembled teams scoring over 50 points.
              Can you crack the top 100?
            </p>
            <div className="flex justify-center gap-4">
              <Button
                onClick={() => navigate('/leaderboard')}
                variant="outline"
                className="border-gold text-gold hover:bg-gold hover:text-navy"
              >
                View Leaderboard
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-navy border-t border-cream/10 py-8">
        <div className="container mx-auto px-4 text-center text-cream/40 text-sm">
          <p>Data from the Lahman Baseball Database (1961-2023)</p>
          <p className="mt-2">Draft players. Build legends. Make history.</p>
        </div>
      </footer>
    </div>
  );
}
