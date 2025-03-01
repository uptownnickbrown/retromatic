# Retromatic Product Requirements Document

This document outlines the core product requirements and design decisions for Retromatic, a fantasy baseball draft game using historical player data from 1961-2023.

## Drafting Mechanics and Game Flow

Retromatic simulates a fantasy baseball draft using historical player data. In **solo draft mode**, a single user drafts a full team of 15 players, one pick at a time, aiming for the highest possible team score. The game flow mirrors a real-life fantasy draft: users enter a draft, proceed through picks making selections, and complete the draft when all required roster slots are filled. Each draft concludes with the team's performance being evaluated through a multi-layered scoring experience.

### Roster Configuration (15 Players)

| Position | Count | Notes |
|----------|-------|-------|
| C | 1 | Catcher |
| 1B | 1 | First Base |
| 2B | 1 | Second Base |
| 3B | 1 | Third Base |
| SS | 1 | Shortstop |
| OF | 3 | Outfield |
| UTIL | 1 | Any batter |
| SP | 3 | Starting Pitcher |
| RP | 2 | Relief Pitcher |
| P | 2 | Any Pitcher |

## Phased Implementation: Solo First, Then Multiplayer

The product will follow a phased approach. The **initial release focuses on solo draft mode** as a fully functional, standalone game. This means the first version allows a single user to draft a team without real-time opponents. Once the solo mode is polished and engaging, **multiplayer live drafts** will be introduced. Building solo mode first ensures the core mechanics are solid before adding real-time multi-user coordination.

## Search and Player Discovery

During the draft, users **can search by player name** and see basic identifying information:
- Player name
- Years active (e.g., "1998-2012")
- Teams played for each year
- Position eligibility

**Stats and z-scores are intentionally hidden during the draft.** This creates a knowledge-based challenge where users must recall player quality from memory rather than simply sorting by stats. The hidden information is revealed only after the draft completes, creating a dramatic reveal experience.

This approach balances usability (you can find the player you're thinking of) with challenge (you must know who's actually good).

## Timer Behavior

**Solo mode has no timer.** Users can take their time, think carefully, and enjoy a relaxed drafting experience. This makes the game accessible and stress-free for casual players.

For future multiplayer mode, a 60-second timer per pick will enforce pace. If time expires, the system auto-picks the highest-rated available player for the needed position.

## Scoring System: The Results Experience

When a draft completes, users receive a multi-layered results experience designed to be fun and informative:

### 1. Simulated 12-Team Roto League
- System randomly selects 11 other teams from the team pool
- Runs full rotisserie scoring across 10 categories
- Shows a complete league scoreboard with user's team highlighted
- "You finished 3rd in this league!"

### 2. Overall Win-Loss Record
- Compares user's team head-to-head against ALL teams in the database
- Reports win-loss record: "Your team would go 8,432-1,568 against all 10,000 teams"
- Provides clear sense of overall team strength

### 3. Category-by-Category Reveal (Animated)
- Dramatic animated reveal of each category's percentile rank
- "Your team's Runs: 1,247 - better than 87% of teams"
- Builds suspense through the animation sequence

### 4. Fun Outlier Callouts
- Detects and highlights interesting facts about the team:
  - "Most stolen bases in the entire database!"
  - "Your pitching staff has the 3rd best ERA ever assembled"
  - "You drafted 3 players from the 1998 Yankees"
- Makes even losing teams feel special

### 5. AI-Generated Commentary
- Uses OpenAI to generate personalized, fun commentary about the team
- "You've assembled a power-hitting juggernaut! With Ruth, McGwire, and Bonds, your team would terrify any pitcher. Watch out for that bullpen though..."

### Scoring Categories (10 total)

| Batting (5) | Pitching (5) |
|-------------|--------------|
| Runs (R) | Wins (W) |
| Home Runs (HR) | Saves (SV) |
| RBIs (RBI) | Strikeouts (K) |
| Stolen Bases (SB) | ERA (lower is better) |
| Batting Average (AVG) | WHIP (lower is better) |

## Star Rating (Position Z-Score Display)

Each player's quality is summarized with a **Star Rating** based on their position-relative z-score. This helps users understand how good their picks were relative to others at the same position.

| Z-Score Range | Display |
|---------------|---------|
| > 2.0 | ⭐⭐⭐⭐⭐ Elite |
| 1.0 - 2.0 | ⭐⭐⭐⭐ All-Star |
| 0.0 - 1.0 | ⭐⭐⭐ Solid |
| -1.0 - 0.0 | ⭐⭐ Average |
| < -1.0 | ⭐ Below Average |

Star ratings are **hidden during the draft** and revealed in the results, adding to the suspense.

## Team Pool for Comparisons

To enable meaningful comparisons before real users populate the system:

**Initial Generation (10,000 simulated teams):**
- For each position, identify top ~250 player-seasons by position z-score
- Simulated draft randomly selects from this "elite pool" per position
- Creates teams that are **reasonable but beatable**:
  - Not perfect (would be boring/unbeatable)
  - Not random bench players (would be obviously terrible)
  - Sweet spot: competitive teams a good player can beat

**Growth over time:**
- Real user teams are added to the pool permanently
- Pool grows organically (10K → 15K → 50K+)
- All comparisons include the full pool

## Authentication Plan

To reduce friction for new users, Retromatic initially allows **guest usage with no login required**. Users can start drafting immediately without creating an account. Draft results are stored with a guest token for later retrieval.

When ready, **social login (Google, OAuth)** will be introduced. Guest data will seamlessly transition to authenticated profiles via token linking.

## Leaderboard

Users can view top scores and their ranking on a global leaderboard. The leaderboard shows:
- Top scores overall
- User's personal best and recent drafts
- Filtering by time period (all-time, this week, this month)

## Draft History

Users can view their past drafts and replay the results:
- List of completed drafts with dates and scores
- Click to view full results for any past draft
- Share functionality for individual results

## Share Functionality

After completing a draft, users can share their results:
- Shareable link that loads the full results page
- Open Graph preview images for social media
- Copy-to-clipboard for easy sharing
