import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { 
  Box, 
  Container, 
  Typography, 
  Stack, 
  Link,
  Divider,
  useTheme,
  useMediaQuery
} from '@mui/material';

export default function Footer() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  return (
    <Box
      sx={{
        bgcolor: theme.palette.grey[900],
        color: 'white',
        py: 3,
        borderTop: 1,
        borderColor: 'divider'
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 2, md: 4 }}
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="body2">
            © {new Date().getFullYear()} Retromatic. All rights reserved
          </Typography>
          
          <Stack 
            direction="row" 
            spacing={3}
            divider={<Box component="span" sx={{ color: 'rgba(255,255,255,0.3)' }}>•</Box>}
          >
            <Link component={RouterLink} to="/" color="inherit" underline="hover">
              Home
            </Link>
            <Link component={RouterLink} to="#" color="inherit" underline="hover">
              About
            </Link>
            <Link component={RouterLink} to="#" color="inherit" underline="hover">
              Privacy
            </Link>
            <Link component={RouterLink} to="#" color="inherit" underline="hover">
              Terms
            </Link>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}