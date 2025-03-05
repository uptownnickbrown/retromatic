import React, { useState, useEffect } from 'react';
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Stack,
  Chip,
  Grid,
  LinearProgress,
  Button,
  Paper,
  CircularProgress,
  Table,
  TableContainer,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Alert,
  Snackbar,
  useTheme
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ReplayIcon from '@mui/icons-material/Replay';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { Player, Draft } from '../types';
import { fetchDraftById } from '../services/supabase';

// Default categories for scoring display
const DEFAULT_CATEGORIES = {
  batting: [
    { name: 'AVG', score: 0, percentile: 0 },
    { name: 'HR', score: 0, percentile: 0 },
    { name: 'RBI', score: 0, percentile: 0 },
    { name: 'R', score: 0, percentile: 0 },
    { name: 'SB', score: 0, percentile: 0 },
  ],
  pitching: [
    { name: 'W', score: 0, percentile: 0 },
    { name: 'SV', score: 0, percentile: 0 },
    { name: 'K', score: 0, percentile: 0 },
    { name: 'ERA', score: 0, percentile: 0 },
    { name: 'WHIP', score: 0, percentile: 0 },
  ]
};

export default function ResultsPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for draft data
  const [draftedPlayers, setDraftedPlayers] = useState<Player[]>([]);
  const [finalScore, setFinalScore] = useState(0);
  const [percentile, setPercentile] = useState(0);
  const [categoryScores, setCategoryScores] = useState(DEFAULT_CATEGORIES);
  
  // Fetch draft data
  useEffect(() => {
    const fetchDraftData = async () => {
      if (!draftId) {
        navigate('/');
        return;
      }
      
      try {
        setIsLoading(true);
        const draft = await fetchDraftById(parseInt(draftId, 10));
        
        if (!draft) {
          throw new Error('Draft not found');
        }
        
        // Set draft data
        const players = draft.picks.map(pick => pick.player);
        setDraftedPlayers(players);
        
        if (draft.score) {
          setFinalScore(draft.score);
        } else {
          // Calculate score if not already set
          const totalScore = players.reduce((sum, player) => sum + player.zScore, 0);
          setFinalScore(totalScore);
        }
        
        if (draft.percentile) {
          setPercentile(draft.percentile);
        }
        
        // For now, we're using default category distributions
        // In a real implementation, we would calculate these
        setCategoryScores({
          batting: DEFAULT_CATEGORIES.batting.map(cat => ({
            ...cat,
            percentile: Math.floor(Math.random() * 100)
          })),
          pitching: DEFAULT_CATEGORIES.pitching.map(cat => ({
            ...cat,
            percentile: Math.floor(Math.random() * 100)
          }))
        });
        
      } catch (error) {
        console.error('Error fetching draft data:', error);
        setError('Failed to load draft results');
        setTimeout(() => navigate('/'), 5000);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchDraftData();
  }, [draftId, navigate]);

  const getPercentileColor = (percentile: number) => {
    if (percentile >= 90) return theme.palette.success.main;
    if (percentile >= 70) return theme.palette.info.main;
    if (percentile >= 50) return theme.palette.primary.main;
    if (percentile >= 30) return theme.palette.warning.main;
    return theme.palette.error.main;
  };

  if (isLoading) {
    return (
      <Container maxWidth="xl" sx={{ py: 5 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <CircularProgress size={60} color="primary" sx={{ mb: 2 }} />
          <Typography variant="h6">Loading draft results...</Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 5 }}>
      {error && (
        <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
          <Alert severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
        </Snackbar>
      )}
      
      <Stack spacing={4}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h3" component="h1" gutterBottom>
            Draft Results
          </Typography>
          <Typography variant="h6" color="text.secondary">
            Your team score has been calculated
          </Typography>
        </Box>

        {/* Overall Score Section */}
        <Paper
          elevation={3}
          sx={{
            p: 4,
            borderRadius: 2,
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 3
          }}
        >
          <Stack spacing={1} sx={{ alignItems: { xs: 'center', md: 'flex-start' } }}>
            <Typography variant="h6" fontWeight="bold">
              Your Team Score
            </Typography>
            <Typography variant="h2" component="div">
              {finalScore.toFixed(1)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip 
                label={`${percentile}th Percentile`} 
                sx={{ 
                  bgcolor: getPercentileColor(percentile),
                  color: 'white',
                  fontWeight: 'bold'
                }}
              />
              <Typography variant="body2">
                Better than {percentile}% of all teams
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress 
              variant="determinate" 
              value={percentile} 
              size={120}
              thickness={5}
              sx={{ 
                color: getPercentileColor(percentile),
                '& .MuiCircularProgress-circle': {
                  strokeLinecap: 'round',
                },
              }}
            />
            <Box
              sx={{
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                position: 'absolute',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="h4"
                component="div"
                color="text.primary"
              >
                {percentile}%
              </Typography>
            </Box>
          </Box>
        </Paper>

        {/* Category Breakdown */}
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Typography variant="h5" component="h2" gutterBottom>
            Category Breakdown
          </Typography>
          <Grid container spacing={4}>
            {/* Batting Categories */}
            <Grid item xs={12} md={6}>
              <Typography variant="h6" component="h3" gutterBottom>
                Batting
              </Typography>
              <Stack spacing={2}>
                {categoryScores.batting.map((category) => (
                  <Box key={category.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">{category.name}</Typography>
                      <Typography variant="body2">{category.percentile}th percentile</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={category.percentile}
                      sx={{ 
                        height: 8, 
                        borderRadius: 4,
                        bgcolor: theme.palette.grey[200],
                        '& .MuiLinearProgress-bar': {
                          bgcolor: getPercentileColor(category.percentile),
                          borderRadius: 4,
                        }
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            </Grid>

            {/* Pitching Categories */}
            <Grid item xs={12} md={6}>
              <Typography variant="h6" component="h3" gutterBottom>
                Pitching
              </Typography>
              <Stack spacing={2}>
                {categoryScores.pitching.map((category) => (
                  <Box key={category.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">{category.name}</Typography>
                      <Typography variant="body2">{category.percentile}th percentile</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={category.percentile}
                      sx={{ 
                        height: 8, 
                        borderRadius: 4,
                        bgcolor: theme.palette.grey[200],
                        '& .MuiLinearProgress-bar': {
                          bgcolor: getPercentileColor(category.percentile),
                          borderRadius: 4,
                        }
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </Paper>

        {/* Team Roster */}
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Typography variant="h5" component="h2" gutterBottom>
            Your Roster
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Player</TableCell>
                  <TableCell>Pos</TableCell>
                  <TableCell>Year</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell align="right">Key Stats</TableCell>
                  <TableCell align="right">Z-Score</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {draftedPlayers.map((player) => (
                  <TableRow key={player.id}>
                    <TableCell sx={{ fontWeight: 'bold' }}>
                      {player.nameFirst} {player.nameLast}
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={player.position} 
                        size="small" 
                        color="primary" 
                        sx={{ fontWeight: 'bold' }}
                      />
                    </TableCell>
                    <TableCell>{player.year}</TableCell>
                    <TableCell>{player.team}</TableCell>
                    <TableCell align="right">
                      {'AVG' in player.stats ? (
                        <Typography variant="body2">
                          {player.stats.AVG.toFixed(3)}/{player.stats.HR}/{player.stats.RBI}/{player.stats.R}/{player.stats.SB}
                        </Typography>
                      ) : (
                        <Typography variant="body2">
                          {(player.stats as any).W}-{(player.stats as any).ERA.toFixed(2)}-{(player.stats as any).WHIP.toFixed(2)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{player.zScore.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
          <Button
            component={RouterLink}
            to="/draft"
            variant="contained"
            color="primary"
            startIcon={<ReplayIcon />}
            size="large"
          >
            Draft Again
          </Button>
          <Button
            component={RouterLink}
            to="/leaderboard"
            variant="outlined"
            color="primary"
            startIcon={<LeaderboardIcon />}
            size="large"
          >
            View Leaderboard
          </Button>
        </Box>
      </Stack>
    </Container>
  );
}