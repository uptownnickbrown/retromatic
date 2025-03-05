import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Stack,
  Container,
  Paper,
  useTheme
} from '@mui/material';
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball';
import HomeIcon from '@mui/icons-material/Home';

export default function NotFound() {
  const theme = useTheme();
  
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Paper
        elevation={3}
        sx={{
          p: 6,
          minHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 2
        }}
      >
        <SportsBaseballIcon 
          color="primary" 
          sx={{ 
            fontSize: 80, 
            mb: 2,
            animation: 'spin 3s linear infinite',
            '@keyframes spin': {
              '0%': {
                transform: 'rotate(0deg)',
              },
              '100%': {
                transform: 'rotate(360deg)',
              },
            },
          }} 
        />
        
        <Typography variant="h1" component="h1" align="center" gutterBottom>
          404
        </Typography>
        
        <Typography variant="h3" component="h2" align="center" gutterBottom>
          Page Not Found
        </Typography>
        
        <Typography variant="h6" align="center" color="text.secondary" paragraph>
          The page you're looking for doesn't exist or has been moved.
        </Typography>
        
        <Button
          component={RouterLink}
          to="/"
          variant="contained"
          color="primary"
          size="large"
          startIcon={<HomeIcon />}
          sx={{ mt: 2 }}
        >
          Return Home
        </Button>
      </Paper>
    </Container>
  );
}