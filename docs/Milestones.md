# Retromatic Development Milestones

The development of Retromatic follows a phased approach. Each phase delivers a working product increment that can be tested and used.

## Phase 0: Documentation & Cleanup

Update all documentation to reflect current design decisions and clean up any legacy code from the previous implementation.

**Deliverables:**
- Updated PRD, Architecture, Styling, and CoreFlows docs
- Clean repository with outdated code removed

## Phase 1: Foundation (Days 1-5)

Set up the core infrastructure for the new application.

**Deliverables:**
- Vite + React + TypeScript frontend initialized
- Node.js + Express backend initialized
- PostgreSQL database with Docker Compose for local dev
- Drizzle ORM configured with database migrations
- Tailwind CSS with vintage baseball theme
- Python data preprocessing scripts cleaned up and outputting to PostgreSQL
- Elite pool identified (~250 top players per position by z-score)
- 10,000 simulated teams generated from elite pool
- Core API endpoints implemented (players, drafts, picks)

## Phase 2: Draft Flow (Days 6-10)

Build the complete drafting experience.

**Deliverables:**
- shadcn/ui component library set up
- DraftPage layout with RosterPanel
- PlayerSearch component (name search, shows years/teams/positions, NO stats)
- Pick validation and roster slot filling logic
- Draft state management with React Query
- Confirmation modal for picks
- Loading states and error handling
- Complete solo draft flow working end-to-end

## Phase 3: Scoring & Results (Days 11-15)

Implement the multi-layered results experience.

**Deliverables:**
- Backend: Category totals calculation
- Backend: 12-team roto league simulation with scoreboard
- Backend: Win-loss record calculation vs team pool
- Backend: Outlier detection (best in category, interesting facts)
- Backend: OpenAI integration for AI commentary
- Frontend: Animated category reveal component (Framer Motion)
- Frontend: Roto league scoreboard display
- Frontend: AI commentary display
- Teams added to pool on completion

## Phase 4: Leaderboard & History (Days 16-20)

Add persistence and social features.

**Deliverables:**
- Leaderboard page with filtering (all-time, week, month)
- Draft history page with ability to view past results
- Guest token system for persistence without login
- Share functionality with shareable links
- Open Graph preview images for social sharing

## Phase 5: Polish & Deploy (Days 21-25)

Final refinements and production deployment.

**Deliverables:**
- Vintage baseball aesthetic applied consistently throughout
- Responsive design tested across devices
- End-to-end testing for all flows
- Backend deployed to Railway or Fly.io
- Frontend deployed to Vercel
- Production PostgreSQL configured
- Environment variables and secrets properly managed
- Monitoring and error tracking set up

## Future Phases (Not in Scope for Initial Release)

### Multiplayer Support
- Live multiplayer drafts with WebSocket synchronization
- Draft lobbies and join codes
- Turn-based picking with timers
- Rejoin logic for disconnected users

### User Authentication
- Social login (Google OAuth)
- User profiles
- Guest-to-authenticated data migration

### Additional Features
- Auction-style draft mode
- Era-adjusted stat balancing
- AI draft opponents
- Weekly challenges and seasonal modes

---

Each phase builds on the previous ones, ensuring we always have a working product that can be tested. The phased approach allows for feedback and iteration at each step.
