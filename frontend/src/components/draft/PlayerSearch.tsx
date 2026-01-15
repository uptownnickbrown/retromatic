import * as React from "react";
import { usePlayerSearch } from "../../hooks/usePlayerSearch";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import type { PlayerSearchResult, PlayerSeason } from "../../types";

interface PlayerSearchProps {
  onSelectPlayer: (playerId: number, playerName: string) => void;
  filterPlayerType?: 'batter' | 'pitcher';
  disabledPlayerIds?: number[];
}

export function PlayerSearch({
  onSelectPlayer,
  filterPlayerType,
  disabledPlayerIds = [],
}: PlayerSearchProps) {
  const [query, setQuery] = React.useState('');
  const [selectedSeason, setSelectedSeason] = React.useState<PlayerSeason | null>(null);

  const { data, isLoading, error } = usePlayerSearch(query);

  const filteredPlayers = React.useMemo(() => {
    if (!data?.players) return [];
    let players = data.players;
    if (filterPlayerType) {
      players = players.filter(p => p.playerType === filterPlayerType);
    }
    return players;
  }, [data?.players, filterPlayerType]);

  const handlePlayerClick = (player: PlayerSearchResult) => {
    if (player.seasons.length === 1) {
      // Only one season, select directly
      const season = player.seasons[0];
      if (!disabledPlayerIds.includes(season.id)) {
        onSelectPlayer(season.id, `${player.name} (${season.year})`);
        setQuery('');
      }
    } else {
      // Multiple seasons, show season selector
      setSelectedSeason(null);
    }
  };

  const handleSeasonSelect = (player: PlayerSearchResult, season: PlayerSeason) => {
    if (!disabledPlayerIds.includes(season.id)) {
      onSelectPlayer(season.id, `${player.name} (${season.year})`);
      setQuery('');
      setSelectedSeason(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Input
          type="text"
          placeholder="Search players by name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="text-lg"
        />
        {isLoading && query.length >= 2 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-5 w-5 border-2 border-sepia border-t-transparent rounded-full" />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-300 rounded-md text-red-800">
          Error searching players: {error.message}
        </div>
      )}

      {filteredPlayers.length > 0 && (
        <div className="border-2 border-cardboard rounded-lg overflow-hidden bg-chalk max-h-96 overflow-y-auto">
          {filteredPlayers.map((player) => (
            <div key={player.id} className="border-b border-cardboard last:border-b-0">
              <button
                onClick={() => handlePlayerClick(player)}
                className="w-full px-4 py-3 text-left hover:bg-cardboard/20 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-display font-semibold text-pinstripe">
                    {player.name}
                  </div>
                  <div className="text-sm text-dirt font-body">
                    {player.yearRange} · {player.teams.join(', ')}
                  </div>
                </div>
                <div className="flex gap-1">
                  {player.positions.slice(0, 3).map((pos) => (
                    <Badge key={pos} variant="secondary" className="text-xs">
                      {pos}
                    </Badge>
                  ))}
                  {player.positions.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{player.positions.length - 3}
                    </Badge>
                  )}
                </div>
              </button>

              {/* Season selector for multi-season players */}
              {player.seasons.length > 1 && (
                <div className="px-4 pb-3 pt-1 bg-cream/50">
                  <div className="text-xs text-dirt mb-2 font-body">Select a season:</div>
                  <div className="flex flex-wrap gap-2">
                    {player.seasons.map((season) => {
                      const isDisabled = disabledPlayerIds.includes(season.id);
                      return (
                        <button
                          key={season.id}
                          onClick={() => handleSeasonSelect(player, season)}
                          disabled={isDisabled}
                          className={cn(
                            "px-3 py-1 rounded-md text-sm font-mono transition-colors",
                            isDisabled
                              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                              : "bg-cardboard hover:bg-sepia hover:text-cream"
                          )}
                        >
                          {season.year} · {season.team}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {query.length >= 2 && !isLoading && filteredPlayers.length === 0 && (
        <div className="text-center py-8 text-dirt font-body">
          No players found for "{query}"
        </div>
      )}

      {query.length < 2 && query.length > 0 && (
        <div className="text-center py-4 text-dirt/60 font-body text-sm">
          Type at least 2 characters to search
        </div>
      )}
    </div>
  );
}
