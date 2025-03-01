# Retromatic Core User Flows

This document describes the key user workflows in Retromatic and the associated system interactions.

## Solo Draft Flow

The primary user flow for drafting a team of historical players.

### 1. Start Draft

**User Action:** Click "Start Draft" on home page

**System:**
- `POST /api/drafts` creates new draft record
- Returns draft ID
- Navigate to `/draft/{draftId}`

### 2. Draft Interface Loads

**System:**
- Fetch available players (all ~30K player-seasons)
- Initialize empty roster with 15 slots
- Display search interface and roster panel

**UI State:**
- Player search area (name input, position filter)
- Player list showing basic info only (NO stats, NO z-scores)
- Roster panel showing empty slots by position

### 3. Search for Players

**User Action:** Type player name in search box

**System:**
- Filter player list by name match
- Show matching players with:
  - Player name
  - Years active (e.g., "1998-2012")
  - Teams played for each year
  - Position eligibility

**Important:** Stats and z-scores are NOT shown during draft.

### 4. Select a Player

**User Action:** Click on a player to draft them

**System:**
- Show confirmation modal
- Display available roster slots for this player's position
- User confirms selection and chooses slot

**API Call:** `POST /api/drafts/{id}/picks`
```json
{
  "playerId": 123,
  "rosterSlot": "OF1"
}
```

**Response:**
- Pick saved
- Player marked as drafted
- Roster slot filled
- Pick count incremented

### 5. Continue Drafting

Repeat steps 3-4 until all 15 roster slots are filled:
- C (1), 1B (1), 2B (1), 3B (1), SS (1), OF (3), UTIL (1)
- SP (3), RP (2), P (2)

### 6. Complete Draft

**User Action:** Draft final player (15th pick)

**System:**
- `POST /api/drafts/{id}/complete` triggers scoring calculation

**Scoring Pipeline:**
1. Calculate category totals for all 10 categories
2. Run 12-team roto league simulation (sample 11 opponents)
3. Calculate win-loss record vs entire team pool
4. Detect outlier achievements
5. Generate AI commentary via OpenAI
6. Add team to team_pool for future comparisons
7. Save all results to draft record

### 7. Results Reveal

**User Action:** View results after draft completion

**UI Flow (animated with Framer Motion):**

1. **Category Reveal** (staggered, ~2 seconds each)
   - Show each category's total and percentile
   - "Runs: 1,247 - better than 87% of teams"
   - Count up animation for numbers

2. **Roto League Scoreboard**
   - Full 12-team standings table
   - User's team highlighted
   - "You finished 3rd in this league!"

3. **Win-Loss Record**
   - "Your team would go 8,432-1,568 against all 10,000 teams"

4. **Outlier Callouts**
   - "Most stolen bases in the entire database!"
   - "Your pitching staff has the 3rd best ERA ever assembled"

5. **AI Commentary**
   - Typewriter-style reveal of personalized team analysis
   - "You've assembled a power-hitting juggernaut!"

6. **Team Summary**
   - Full roster with all stats now revealed
   - Star ratings for each player
   - Category z-scores visible

### 8. Post-Draft Actions

**Available Actions:**
- View Leaderboard
- Share Results (generates shareable link)
- Draft Again
- View Draft History

---

## Leaderboard Flow

### View Leaderboard

**API Call:** `GET /api/leaderboard?limit=50&period=all`

**Response:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "displayName": "Guest_a1b2c3",
      "score": 97.5,
      "percentile": 99,
      "completedAt": "2024-01-15T..."
    }
  ],
  "userRank": 127,
  "totalTeams": 10500
}
```

**UI:**
- Table showing top scores
- User's rank highlighted if in list
- Filter by time period (all, week, month)

---

## Draft History Flow

### View Past Drafts

**API Call:** `GET /api/users/{userId}/drafts`

**Response:**
```json
{
  "drafts": [
    {
      "id": 456,
      "completedAt": "2024-01-15T...",
      "score": 85.2,
      "percentile": 87,
      "rotoPlacement": 3
    }
  ]
}
```

**User Action:** Click on past draft

**System:** Load full results for that draft (same as step 7 above)

---

## Share Flow

### Generate Share Link

**User Action:** Click "Share Results"

**API Call:** `POST /api/share/{draftId}`

**Response:**
```json
{
  "shareUrl": "https://retromatic.app/results/abc123",
  "ogImage": "https://retromatic.app/og/abc123.png"
}
```

**System:**
- Generate unique share URL
- Create Open Graph preview image with team summary
- Copy URL to clipboard

**Shared Link Behavior:**
- Anyone can view the results
- Shows full team roster, scores, and AI commentary
- Includes "Draft Your Own Team" CTA

---

## Guest Token Flow

### First Visit

**System:**
- Generate UUID guest token
- Store in localStorage
- Include in all API requests via header

### Draft Completion

**System:**
- Draft saved with guest_token reference
- Team added to pool
- Leaderboard entry created

### Return Visit

**System:**
- Read guest token from localStorage
- Fetch user's draft history
- Restore session

### Future: Account Creation

**User Action:** Sign up with Google OAuth

**System:**
- Link guest_token to new user account
- Migrate all drafts/scores to authenticated user
- Clear guest token, use user session

---

## Error Handling

### Draft Errors

**Duplicate Player:**
- API returns 400 error
- UI shows "Player already drafted"

**Invalid Roster Slot:**
- API returns 400 error
- UI shows "Player not eligible for this position"

**Draft Already Complete:**
- API returns 400 error
- Redirect to results page

### Network Errors

**API Unavailable:**
- Show retry option
- Draft state preserved in local state
- Retry submission on reconnect

**OpenAI API Error:**
- Generate fallback commentary
- "Your team scored in the Xth percentile!"
- Don't block results display
