import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Grid,
  Typography,
  Button,
  Container,
  Paper,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Chip,
  Stack,
  Divider,
  CircularProgress,
  LinearProgress,
  Alert,
  Snackbar,
  Card,
  CardContent,
  useTheme,
  lighten,
  alpha
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import TimerIcon from '@mui/icons-material/Timer';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SportsTennisIcon from '@mui/icons-material/SportsTennis';
import { PlayerPosition, RosterRequirements, Player } from '../types';
import { fetchPlayers, createDraft, savePick, completeDraft } from '../services';

// Define roster requirements
const ROSTER_REQUIREMENTS: RosterRequirements = {
  'C': 1,
  '1B': 1,
  '2B': 1,
  '3B': 1,
  'SS': 1,
  'OF': 3,
  'UTIL': 1,
  'SP': 3,
  'RP': 2,
  'P': 2,
};

export default function DraftPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  
  // State for draft
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(60); // 60 seconds per pick
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<PlayerPosition | 'ALL'>('ALL');
  const [draftInstance, setDraftInstance] = useState<number | null>(null);
  
  // Calculate total rounds based on roster requirements
  const totalRounds = Object.values(ROSTER_REQUIREMENTS).reduce((sum, num) => sum + num, 0);

  // Initialize draft and fetch players
  useEffect(() => {
    const initDraft = async () => {
      setIsLoading(true);
      try {
        // If draftId is provided, use it; otherwise create a new draft
        let draftId = null;
        if (!draftInstance) {
          const draft = await createDraft();
          if (draft) {
            setDraftInstance(draft.id);
            draftId = draft.id;
          } else {
            throw new Error('Failed to create draft');
          }
        }

        // Fetch players from the API
        const players = await fetchPlayers();
        if (players && players.length > 0) {
          setAvailablePlayers(players);
          setIsLoading(false);
        } else {
          throw new Error('Failed to fetch players');
        }
      } catch (error) {
        console.error('Draft initialization error:', error);
        setErrorMessage('Failed to initialize draft. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    initDraft();
  }, []);

  // Effect for timer countdown
  useEffect(() => {
    if (selectedPlayers.length >= totalRounds) return; // Draft complete
    
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time's up - auto-pick a player
          handleAutoPick();
          return 60; // Reset timer
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [selectedPlayers.length, totalRounds]);
  
  // Filter and search players
  console.log("Search term:", searchTerm);
  console.log("Position filter:", positionFilter);
  console.log("Total available players:", availablePlayers.length);
  
  const filteredPlayers = availablePlayers.filter(player => {
    // Apply position filter
    if (positionFilter !== 'ALL' && player.position !== positionFilter) {
      return false;
    }
    
    // Apply search term
    if (searchTerm && searchTerm.trim() !== '') {
      const searchTermLower = searchTerm.toLowerCase().trim();
      const fullName = `${player.nameFirst} ${player.nameLast}`.toLowerCase();
      const team = player.team?.toLowerCase() || '';
      const year = player.year.toString();
      
      const matchesSearch = (
        fullName.includes(searchTermLower) ||
        team.includes(searchTermLower) ||
        year.includes(searchTermLower)
      );
      
      return matchesSearch;
    }
    
    return true;
  });
  
  console.log("Filtered players count:", filteredPlayers.length);

  // Function to handle auto-picking when time runs out
  const handleAutoPick = () => {
    // In a real implementation, this would pick the best available player
    // For now, just pick the first one that fits a needed position
    const neededPositions = getNeededPositions();
    if (neededPositions.length === 0) return;
    
    const availableForPosition = availablePlayers.filter(p => 
      neededPositions.includes(p.position as PlayerPosition)
    );
    
    if (availableForPosition.length > 0) {
      handleSelectPlayer(availableForPosition[0]);
      setErrorMessage(`Time ran out. ${availableForPosition[0].nameFirst} ${availableForPosition[0].nameLast} was auto-picked.`);
    }
  };

  // Calculate which positions still need to be filled
  const getNeededPositions = (): PlayerPosition[] => {
    const countByPosition: Partial<Record<PlayerPosition, number>> = {};
    
    // Initialize counts
    Object.keys(ROSTER_REQUIREMENTS).forEach(pos => {
      countByPosition[pos as PlayerPosition] = 0;
    });
    
    // Count selected players by position
    selectedPlayers.forEach(player => {
      const pos = player.position as PlayerPosition;
      countByPosition[pos] = (countByPosition[pos] || 0) + 1;
    });
    
    // Find positions that need more players
    return Object.entries(ROSTER_REQUIREMENTS).filter(([pos, required]) => 
      (countByPosition[pos as PlayerPosition] || 0) < required
    ).map(([pos]) => pos as PlayerPosition);
  };

  // Handle player selection
  const handleSelectPlayer = async (player: Player) => {
    if (!draftInstance) {
      setErrorMessage('Draft not initialized');
      return;
    }

    try {
      // Save the pick to the database
      const pickNumber = selectedPlayers.length + 1;
      const savedPick = await savePick(draftInstance, player.id, pickNumber, currentRound);
      
      if (!savedPick) {
        throw new Error('Failed to save pick');
      }
      
      // Add player to selected list
      setSelectedPlayers([...selectedPlayers, player]);
      
      // Remove from available players
      setAvailablePlayers(availablePlayers.filter(p => p.id !== player.id));
      
      // Increment round if not the last pick
      if (selectedPlayers.length + 1 < totalRounds) {
        setCurrentRound(currentRound + 1);
        setTimeLeft(60); // Reset timer
      } else {
        // Draft complete
        handleDraftComplete();
      }
    } catch (error) {
      console.error('Error selecting player:', error);
      setErrorMessage('Failed to select player. Please try again.');
    }
  };

  // Handle draft completion
  const handleDraftComplete = async () => {
    if (!draftInstance) {
      setErrorMessage('Draft not initialized');
      return;
    }
    
    try {
      // Calculate the team's final score
      const totalScore = selectedPlayers.reduce((sum, player) => sum + player.zScore, 0);
      
      // Complete the draft in the database
      const completedDraft = await completeDraft(draftInstance, totalScore);
      
      if (!completedDraft) {
        throw new Error('Failed to complete draft');
      }
      
      setErrorMessage('Draft complete! Your team has been assembled. Calculating results...');
      
      // Navigate to results page
      navigate(`/results/${draftInstance}`);
    } catch (error) {
      console.error('Error completing draft:', error);
      setErrorMessage('Failed to complete draft. Please try again.');
    }
  };

  // Check if a position is filled to capacity
  const isPositionFilled = (position: PlayerPosition): boolean => {
    const count = selectedPlayers.filter(p => p.position === position).length;
    return count >= (ROSTER_REQUIREMENTS[position] || 0);
  };

  // Get timer color based on time left
  const getTimerColor = () => {
    if (timeLeft > 30) return theme.palette.success.main;
    if (timeLeft > 10) return theme.palette.warning.main;
    return theme.palette.error.main;
  };

  // Get position color
  const getPositionColor = (position: string) => {
    switch(position[0]) {
      case 'C': return theme.palette.primary.main;
      case '1':
      case '2':
      case '3': 
      case 'S': return theme.palette.info.main;
      case 'O': return theme.palette.success.main;
      case 'U': return theme.palette.warning.main;
      case 'P':
      case 'S':
      case 'R': return theme.palette.secondary.main;
      default: return theme.palette.primary.main;
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" align="center" gutterBottom>
        Solo Draft
      </Typography>
      
      {/* Snackbar for notifications */}
      <Snackbar 
        open={!!errorMessage} 
        autoHideDuration={5000} 
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setErrorMessage(null)} 
          severity={errorMessage?.includes('Error') ? 'error' : 'info'}
          sx={{ width: '100%' }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>
      
      {/* Draft Progress */}
      <Paper 
        elevation={2} 
        sx={{ 
          p: 2, 
          mb: 3, 
          borderRadius: 2,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">
            Round {currentRound} of {totalRounds}
          </Typography>
          <LinearProgress 
            variant="determinate" 
            value={(currentRound - 1) / totalRounds * 100} 
            sx={{ 
              width: { xs: '100%', sm: '120px' }, 
              height: 10, 
              borderRadius: 5,
              ml: 2
            }} 
          />
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TimerIcon sx={{ color: getTimerColor() }} />
          <Typography variant="h6" sx={{ color: getTimerColor() }}>
            Time left: {timeLeft}s
          </Typography>
        </Box>
      </Paper>
      
      <Grid container spacing={3}>
        {/* Available Players */}
        <Grid item xs={12} lg={8}>
          <Paper 
            elevation={3} 
            sx={{ 
              p: 3, 
              borderRadius: 2,
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h5" component="h2">
                Available Players
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {filteredPlayers.length} players found
              </Typography>
            </Box>
            
            {/* Search and filter controls */}
            <Box 
              sx={{ 
                display: 'flex', 
                flexDirection: { xs: 'column', sm: 'row' }, 
                gap: 2, 
                mb: 3
              }}
            >
              <TextField
                placeholder="Search by name, team, or year..."
                value={searchTerm}
                onChange={(e) => {
                  const newValue = e.target.value;
                  console.log("Input changed to:", newValue);
                  setSearchTerm(newValue);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    console.log("Enter pressed with value:", searchTerm);
                  }
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
                fullWidth
                size="small"
                variant="outlined"
              />
              
              <FormControl sx={{ minWidth: 120 }} size="small">
                <InputLabel id="position-filter-label">Position</InputLabel>
                <Select
                  labelId="position-filter-label"
                  value={positionFilter}
                  label="Position"
                  onChange={(e) => setPositionFilter(e.target.value as PlayerPosition | 'ALL')}
                >
                  <MenuItem value="ALL">All Positions</MenuItem>
                  <MenuItem value="C">C</MenuItem>
                  <MenuItem value="1B">1B</MenuItem>
                  <MenuItem value="2B">2B</MenuItem>
                  <MenuItem value="3B">3B</MenuItem>
                  <MenuItem value="SS">SS</MenuItem>
                  <MenuItem value="OF">OF</MenuItem>
                  <MenuItem value="UTIL">UTIL</MenuItem>
                  <MenuItem value="SP">SP</MenuItem>
                  <MenuItem value="RP">RP</MenuItem>
                  <MenuItem value="P">P</MenuItem>
                </Select>
              </FormControl>
            </Box>
            
            {isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <CircularProgress size={60} thickness={4} />
              </Box>
            ) : (
              <Box sx={{ flexGrow: 1, overflow: 'auto', maxHeight: '60vh' }}>
                {filteredPlayers.length === 0 ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px' }}>
                    <Typography color="text.secondary">
                      No players match your search criteria
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={2}>
                    {filteredPlayers.map(player => (
                      <Card 
                        key={player.id} 
                        variant="outlined"
                        sx={{ 
                          '&:hover': { 
                            boxShadow: 3,
                            bgcolor: alpha(theme.palette.primary.main, 0.05)
                          }
                        }}
                      >
                        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="subtitle1" fontWeight="bold">
                                  {player.nameFirst} {player.nameLast}
                                </Typography>
                                <Chip 
                                  label={player.position} 
                                  size="small" 
                                  sx={{ 
                                    bgcolor: getPositionColor(player.position),
                                    color: 'white',
                                    fontWeight: 'bold'
                                  }} 
                                />
                                <Typography variant="body2" color="text.secondary">
                                  {player.year} {player.team}
                                </Typography>
                              </Box>
                              
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                {'AVG' in player.stats ? (
                                  <>
                                    <Typography variant="body2">AVG: {player.stats.AVG.toFixed(3)}</Typography>
                                    <Typography variant="body2">HR: {player.stats.HR}</Typography>
                                    <Typography variant="body2">RBI: {player.stats.RBI}</Typography>
                                    <Typography variant="body2">R: {player.stats.R}</Typography>
                                    <Typography variant="body2">SB: {player.stats.SB}</Typography>
                                  </>
                                ) : (
                                  <>
                                    <Typography variant="body2">W: {(player.stats as any).W}</Typography>
                                    <Typography variant="body2">SV: {(player.stats as any).SV}</Typography>
                                    <Typography variant="body2">K: {(player.stats as any).K}</Typography>
                                    <Typography variant="body2">ERA: {(player.stats as any).ERA.toFixed(2)}</Typography>
                                    <Typography variant="body2">WHIP: {(player.stats as any).WHIP.toFixed(2)}</Typography>
                                  </>
                                )}
                                <Chip 
                                  label={`Z: ${player.zScore.toFixed(1)}`} 
                                  size="small" 
                                  color="success" 
                                  variant="outlined"
                                />
                              </Box>
                            </Box>
                            
                            <Button
                              variant="contained"
                              color="primary"
                              size="small"
                              onClick={() => handleSelectPlayer(player)}
                              disabled={isPositionFilled(player.position as PlayerPosition)}
                              sx={{ minWidth: 100 }}
                            >
                              Draft
                            </Button>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Paper>
        </Grid>
        
        {/* Team Roster */}
        <Grid item xs={12} lg={4}>
          <Paper 
            elevation={3}
            sx={{ 
              p: 3, 
              borderRadius: 2,
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <Typography variant="h5" component="h2" gutterBottom>
              Your Team
            </Typography>
            
            <Stack spacing={2} sx={{ flex: 1 }}>
              {Object.entries(ROSTER_REQUIREMENTS).map(([position, count]) => (
                <Box key={position}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                      {position}
                    </Typography>
                    <Typography>
                      {selectedPlayers.filter(p => p.position === position).length}/{count}
                    </Typography>
                  </Box>
                  
                  <Stack spacing={1} sx={{ mb: 2 }}>
                    {Array.from({ length: count }).map((_, idx) => {
                      const player = selectedPlayers.find(
                        (p, i) => 
                          p.position === position && 
                          selectedPlayers.filter(sp => sp.position === position).indexOf(p) === idx
                      );
                      
                      return (
                        <Paper 
                          key={`${position}-${idx}`}
                          variant="outlined"
                          sx={{ 
                            p: 1.5,
                            bgcolor: player ? alpha(getPositionColor(position), 0.1) : 'transparent',
                            borderColor: player ? getPositionColor(position) : 'divider',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                          }}
                        >
                          {player ? (
                            <>
                              <CheckCircleIcon 
                                fontSize="small" 
                                sx={{ color: getPositionColor(position) }} 
                              />
                              <Typography variant="body2">
                                {player.nameFirst} {player.nameLast}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Empty
                            </Typography>
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>
                  
                  <Divider />
                </Box>
              ))}
            </Stack>
            
            {selectedPlayers.length === totalRounds && (
              <Button 
                variant="contained"
                color="secondary"
                size="large"
                onClick={handleDraftComplete}
                sx={{ mt: 3 }}
              >
                Finish Draft
              </Button>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}