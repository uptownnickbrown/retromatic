# Retromatic Styling Guide

This document describes the front-end design approach for Retromatic, including the visual style, component library, and responsive layout strategy.

## Component Library: shadcn/ui + Tailwind CSS

Retromatic uses **shadcn/ui** components built on **Tailwind CSS** for a modern, highly customizable design system. This approach provides:

- Pre-built, accessible components (buttons, dialogs, forms, cards)
- Full customization through Tailwind configuration
- Type-safe components with TypeScript
- Small bundle size (only import what you use)

## Vintage Baseball Aesthetic

The design evokes vintage baseball scorecards, old baseball cards, and classic stadium scoreboards.

### Color Palette

```css
/* Tailwind config extension */
colors: {
  cream: '#F5F5DC',      /* Background, cards */
  sepia: '#704214',      /* Dark text, borders */
  cardboard: '#D4B896',  /* Card backgrounds, accents */
  grass: '#228B22',      /* Success states, positive indicators */
  leather: '#8B4513',    /* Secondary text, warm accents */
  pinstripe: '#1C2951',  /* Navy for contrast, headers */
  chalk: '#FFFFFF',      /* Pure white for line elements */
  dirt: '#8B7355',       /* Muted backgrounds */
}
```

### Typography

```css
fontFamily: {
  display: ['Playfair Display', 'serif'],    /* Headlines, player names */
  body: ['Libre Baskerville', 'serif'],      /* Body text, descriptions */
  mono: ['IBM Plex Mono', 'monospace'],      /* Stats, numbers, scores */
}
```

**Usage:**
- **Playfair Display** for headlines, page titles, and player names
- **Libre Baskerville** for body copy and descriptions
- **IBM Plex Mono** for all statistics, scores, and numerical data

### Design Elements

- **Borders**: Subtle sepia-toned borders, slightly rounded (4-8px radius)
- **Cards**: Cream or cardboard backgrounds with subtle shadows
- **Buttons**: Solid fills with sepia text, hover states with slight darkening
- **Tables**: Clean lines, alternating row colors for readability

## Key Components

### Star Rating Display

Position z-scores are displayed as star ratings to summarize player quality:

```
⭐⭐⭐⭐⭐ Elite (z > 2.0)
⭐⭐⭐⭐ All-Star (1.0 - 2.0)
⭐⭐⭐ Solid (0.0 - 1.0)
⭐⭐ Average (-1.0 - 0.0)
⭐ Below Average (z < -1.0)
```

Design: Gold stars on cream background, with text label below.

### Player Cards (During Draft)

During the draft, player cards show LIMITED information:
- Player name (Playfair Display font)
- Years active (e.g., "1998-2012")
- Teams played for
- Position eligibility

**NO stats or z-scores are shown during the draft.**

### Player Cards (Results Reveal)

After draft completion, full stats are revealed:
- All counting stats
- Star rating
- Position z-score
- Category z-scores

### Roster Panel

Displays the 15 roster slots with visual distinction:
- **Filled slots**: Show player name with star rating
- **Empty slots**: Subtle dashed border, position label
- **Position groups**: Batters (cream) and Pitchers (slightly different shade)

### Results Reveal Animation

The dramatic reveal uses Framer Motion for animated transitions:
1. Category-by-category reveal with counting animation
2. Final score with celebratory treatment
3. Roto league scoreboard fade-in
4. AI commentary typewriter effect

## Responsive Design

### Mobile First

The UI is built mobile-first with breakpoints:
- **Mobile** (<768px): Single column, stacked layout
- **Tablet** (768-1024px): Two-column where appropriate
- **Desktop** (>1024px): Full layout with sidebars

### Draft Screen Layouts

**Mobile:**
- Search/player list takes full width
- Roster panel in collapsible drawer at bottom
- Fixed header with draft progress

**Desktop:**
- Three-column layout: Search | Player List | Roster Panel
- All information visible without scrolling

### Results Screen Layouts

**Mobile:**
- Vertical stacking of all result sections
- Swipeable tabs for different views (Summary, Roto League, Team)

**Desktop:**
- Side-by-side layout for team roster and scoring details
- Roto league scoreboard as prominent center element

## Animation Guidelines

Use animations sparingly and purposefully:

- **Page transitions**: Subtle fade (200ms)
- **Card interactions**: Scale on hover (1.02x)
- **Results reveal**: Staggered entrance with counting animations
- **Score updates**: Number counting from 0 to final value

All animations should be:
- Fast enough not to impede usability
- Smooth at 60fps
- Disabled for users who prefer reduced motion

## Accessibility

- Minimum contrast ratio of 4.5:1 for text
- Focus states clearly visible
- Keyboard navigation supported throughout
- Screen reader labels for all interactive elements
- Star ratings include text alternatives

## Dark Mode

Not planned for MVP. The vintage aesthetic works best with light, cream-colored backgrounds that evoke old baseball scorecards.

## Icons

Use simple, recognizable baseball iconography:
- Baseball diamond for position indicators
- Simple silhouettes rather than detailed illustrations
- Consistent stroke weight across icon set
