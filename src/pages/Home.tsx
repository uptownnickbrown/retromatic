import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Container,
  Button,
  Stack,
  Grid,
  Paper,
  useTheme,
  useMediaQuery,
  Card,
  CardContent,
  Divider,
  IconButton
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import TimerIcon from '@mui/icons-material/Timer';

export default function HomePage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  return (
    <Box>
      {/* Hero Section */}
      <Container maxWidth="lg">
        <Box 
          sx={{
            textAlign: 'center',
            py: { xs: 5, md: 10 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}
        >
          <Typography 
            variant="h2" 
            component="h1" 
            gutterBottom
            sx={{ 
              fontWeight: 600,
              fontSize: { xs: '2rem', sm: '3rem', md: '4rem' },
              lineHeight: 1.1
            }}
          >
            Draft your dream team from <br />
            <Box component="span" sx={{ color: 'primary.main' }}>
              baseball history
            </Box>
          </Typography>
          
          <Typography 
            variant="h5" 
            color="text.secondary"
            sx={{ 
              maxWidth: '800px',
              mb: 5
            }}
          >
            Retromatic combines fantasy baseball, Sporcle, and Immaculate Grid into one thrilling game. 
            Draft legendary players from any era, test your baseball knowledge, and compete for the highest team score.
          </Typography>
          
          <Stack direction="column" spacing={2} alignItems="center">
            <Button
              component={RouterLink}
              to="/draft"
              variant="contained"
              color="primary"
              size="large"
              sx={{ 
                borderRadius: '28px',
                px: 4,
                py: 1.5,
                fontSize: '1.1rem'
              }}
            >
              Start Solo Draft
            </Button>
            
            <Button
              component={RouterLink}
              to="/how-to-play"
              color="primary"
              endIcon={<ChevronRightIcon />}
            >
              How to play
            </Button>
          </Stack>
        </Box>
      </Container>

      {/* Features Section */}
      <Box sx={{ py: 6, bgcolor: 'background.paper' }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <Feature
                icon={<SportsBaseballIcon />}
                emoji="⚾"
                title="Historical Players"
                text="Draft MLB legends from 1871 to 2023. Test your knowledge of baseball history by recalling players across all eras."
              />
            </Grid>
            
            <Grid item xs={12} md={4}>
              <Feature
                icon={<EmojiEventsIcon />}
                emoji="🏆"
                title="Competitive Scoring"
                text="Your team is ranked against all others using percentile scoring based on historical stats. Challenge yourself to climb the leaderboards."
              />
            </Grid>
            
            <Grid item xs={12} md={4}>
              <Feature
                icon={<TimerIcon />}
                emoji="⏱️"
                title="Draft Timer"
                text="Feel the pressure of a real draft with our countdown timer. Make your pick before time runs out or the system will auto-pick for you."
              />
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Call to Action */}
      <Box sx={{ bgcolor: 'primary.light', py: 5 }}>
        <Container maxWidth="lg">
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={6}>
              <Typography variant="h3" component="h2" gutterBottom>
                Ready to test your baseball knowledge?
              </Typography>
              
              <Typography variant="h6" paragraph>
                Jump into a solo draft to see if you can build a team that stands among the greatest in Retromatic history.
              </Typography>
              
              <Button
                component={RouterLink}
                to="/draft"
                variant="contained"
                color="secondary"
                size="large"
                endIcon={<ChevronRightIcon />}
                sx={{ mt: 2 }}
              >
                Start Drafting Now
              </Button>
            </Grid>
            
            <Grid item xs={12} md={6}>
              {/* Placeholder for a baseball card or draft board image */}
              <Paper 
                sx={{ 
                  bgcolor: 'background.paper', 
                  borderRadius: 2, 
                  height: 300, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  boxShadow: 3
                }}
              >
                <Typography variant="h6" color="text.secondary">
                  Baseball Card Image
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </Box>
  );
}

interface FeatureProps {
  title: string;
  text: string;
  icon: React.ReactElement;
  emoji: string;
}

const Feature = ({ title, text, icon, emoji }: FeatureProps) => {
  return (
    <Paper 
      elevation={2}
      sx={{ 
        p: 3, 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        textAlign: 'center' 
      }}
    >
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        width: 60,
        height: 60,
        borderRadius: '50%',
        bgcolor: 'primary.light',
        color: 'primary.main',
        mb: 2
      }}>
        {icon}
      </Box>
      
      <Typography variant="h5" component="h3" sx={{ mb: 1, fontWeight: 600 }}>
        {title}
      </Typography>
      
      <Typography color="text.secondary">
        {text}
      </Typography>
    </Paper>
  );
};