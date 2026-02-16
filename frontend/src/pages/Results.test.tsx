import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Results } from './Results';
import type { ResultsData } from '../types';

// Mock the API module
vi.mock('../lib/api', () => ({
  getChallengeResults: vi.fn(),
}));

import * as api from '../lib/api';

function makeResultsData(overrides: Partial<{
  totalLegendScore: unknown;
  percentile: unknown;
  completedAt: unknown;
  legendScores: unknown[];
}>): ResultsData {
  const defaults = {
    totalLegendScore: overrides.totalLegendScore ?? 65.3,
    percentile: overrides.percentile ?? 72,
    completedAt: overrides.completedAt ?? '2026-02-16T12:00:00Z',
    legendScores: overrides.legendScores ?? [7.2, 5.1, 8.3, 4.0, 6.5, 7.8, 9.1, 3.2, 6.0, 8.1],
  };

  const picks = defaults.legendScores.map((ls, i) => ({
    roundNumber: i + 1,
    position: ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'][i],
    playerName: `Player ${i + 1}`,
    year: 2000 + i,
    team: 'NYY',
    legendScore: ls as number,
    stats: { war: 5 },
    wasTimeout: false,
  }));

  return {
    session: {
      totalLegendScore: defaults.totalLegendScore as number,
      percentile: defaults.percentile as number,
      completedAt: defaults.completedAt as string,
    },
    picks,
    perfectLineup: {
      picks: picks.map(p => ({
        roundNumber: p.roundNumber,
        position: p.position,
        playerName: p.playerName,
        year: p.year,
        legendScore: 9.5,
      })),
      totalScore: 95,
    },
    totalParticipants: 42,
  };
}

function renderResults(challengeId = '1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/results/${challengeId}`]}>
        <Routes>
          <Route path="/results/:challengeId" element={<Results />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Results page', () => {
  it('renders scores without crashing', async () => {
    const data = makeResultsData({});
    vi.mocked(api.getChallengeResults).mockResolvedValue(data);

    renderResults();

    // Wait for async data to load
    expect(await screen.findByText('Final Legend Score')).toBeInTheDocument();
    // Score appears in both the badge and the text display
    expect(screen.getAllByText('65.3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('/100')).toBeInTheDocument();
  });

  it('renders correctly when API returns string values (Drizzle leak regression)', async () => {
    // Simulate the original bug: Drizzle returns decimals as strings
    const data = makeResultsData({
      totalLegendScore: '65.3' as unknown,
      percentile: '72' as unknown,
      legendScores: ['7.2', '5.1', '8.3', '4.0', '6.5', '7.8', '9.1', '3.2', '6.0', '8.1'],
    });
    vi.mocked(api.getChallengeResults).mockResolvedValue(data);

    renderResults();

    // Should still render without crashing even with string values
    expect(await screen.findByText('Final Legend Score')).toBeInTheDocument();
    expect(screen.getAllByText('65.3').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.getChallengeResults).mockRejectedValue(new Error('Network error'));

    renderResults();

    expect(await screen.findByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Back Home')).toBeInTheDocument();
  });
});
