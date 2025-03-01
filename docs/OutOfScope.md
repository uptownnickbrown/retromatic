# Out of Scope for MVP

This document lists features and enhancements that are **beyond the scope of the initial release** for Retromatic. These are ideas for future development once the core product is stable and successful.

## Multiplayer Drafts

Live multiplayer drafts where multiple users draft against each other in real-time. This requires:
- WebSocket infrastructure for real-time synchronization
- Lobby system with join codes
- Turn-based picking with timers and auto-pick
- Reconnection and rejoin logic

**Why deferred:** Significant complexity. Solo mode must be fun and polished first.

## User Authentication

Full account system with social login (Google OAuth). This would enable:
- User profiles
- Cross-device access to draft history
- Username display on leaderboards

**Why deferred:** Guest mode with token-based persistence is sufficient for MVP. Auth adds friction.

## Auction-Style Drafting

A draft mode where users have budgets and bid on players in real-time auctions, instead of turn-based picks. This would add strategic depth but requires:
- Bidding interface
- Budget management
- Auction timer
- Different scoring/evaluation system

**Why deferred:** Completely different game mode requiring its own design and implementation.

## Era-Adjusted Stat Balancing

Adjustments to player statistics to account for different eras of baseball. For example, normalizing stats so a 1915 pitcher can be fairly compared to a 1995 pitcher. This could involve:
- League average factors by era
- Park factors
- Steroid era adjustments

**Why deferred:** Complex data analysis. Current z-score approach provides reasonable cross-era comparison.

## AI Draft Opponents

Computer-controlled opponents for solo play that evaluate remaining players and make competitive picks. This would require:
- AI algorithms or ML models trained on draft data
- Difficulty levels
- Personality/strategy variations

**Why deferred:** Significant AI development. Current solo mode against pre-generated team pool provides good benchmarking.

## Stat Sorting and Advanced Filtering

Sorting players by statistics or advanced filtering during the draft. The MVP allows:
- Name search
- Position filtering

But does NOT allow:
- Sorting by HR, AVG, ERA, etc.
- Filtering by statistical thresholds
- Viewing stats during draft

**Why deferred:** Intentional design choice. Hidden stats create knowledge-based challenge. May add as optional "easy mode" later.

## Additional Game Modes

Other potential modes not in initial release:
- **Blitz Draft**: Timed picks (30 seconds each)
- **Target Challenge**: Draft team to hit specific stat targets
- **Position Draft**: Draft only one position (best OF team, best pitching staff)
- **Decade Draft**: Draft only from specific era
- **Salary Cap**: Budget-based team building without auction

**Why deferred:** Core experience must be proven first. These could be future engagement features.

## Social Features

Advanced social functionality:
- Friends list
- Direct challenges
- Team comparisons between friends
- Discord/Slack integration

**Why deferred:** Requires auth system and more complex backend. Share links provide basic social functionality for MVP.

## Mobile Apps

Native iOS/Android applications. MVP is web-only with responsive design.

**Why deferred:** Web app reaches all platforms. Native apps only justified after significant user base.

---

Each of these features may be detailed in their own design documents when prioritized for development. For now, the focus is delivering a fun, polished solo draft experience with engaging results presentation.
