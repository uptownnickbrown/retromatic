import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link as RouterLink } from 'react-router-dom';
import { 
  Container, 
  Typography, 
  Box, 
  Paper, 
  Button, 
  AppBar, 
  Toolbar, 
  Stack,
  Link,
  useTheme,
  useMediaQuery,
  Drawer,
  List,
  ListItem,
  ListItemText,
  IconButton
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball';

// Import pages
import Home from './pages/Home';
import Draft from './pages/Draft';
import Results from './pages/Results';
import NotFound from './pages/NotFound';

function App() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  
  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };
  
  const drawerContent = (
    <Box sx={{ width: 250 }} role="presentation" onClick={toggleDrawer}>
      <List>
        <ListItem component={RouterLink} to="/" sx={{ color: 'inherit', textDecoration: 'none' }}>
          <ListItemText primary="Home" />
        </ListItem>
        <ListItem component={RouterLink} to="/draft" sx={{ color: 'inherit', textDecoration: 'none' }}>
          <ListItemText primary="Draft" />
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Router>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar position="static" color="primary">
          <Toolbar>
            {isMobile && (
              <IconButton
                edge="start"
                color="inherit"
                aria-label="menu"
                onClick={toggleDrawer}
                sx={{ mr: 2 }}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Typography 
              variant="h6" 
              component={RouterLink} 
              to="/" 
              sx={{ 
                flexGrow: 1, 
                textDecoration: 'none', 
                color: 'white',
                fontWeight: 'bold' 
              }}
            >
              Retromatic
            </Typography>
            {!isMobile && (
              <Stack direction="row" spacing={3}>
                <Link 
                  component={RouterLink} 
                  to="/" 
                  color="inherit" 
                  underline="none"
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  <HomeIcon sx={{ mr: 0.5 }} />
                  Home
                </Link>
                <Link 
                  component={RouterLink} 
                  to="/draft" 
                  color="inherit" 
                  underline="none"
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  <SportsBaseballIcon sx={{ mr: 0.5 }} />
                  Draft
                </Link>
              </Stack>
            )}
            <Button 
              component={RouterLink} 
              to="/draft" 
              variant="contained" 
              color="secondary"
              sx={{ ml: 2 }}
            >
              Start Drafting
            </Button>
          </Toolbar>
        </AppBar>
        
        {/* Mobile drawer */}
        <Drawer
          anchor="left"
          open={drawerOpen}
          onClose={toggleDrawer}
        >
          {drawerContent}
        </Drawer>
        
        <Box component="main" sx={{ flexGrow: 1, py: 3 }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/draft" element={<Draft />} />
            <Route path="/draft/:draftId" element={<Draft />} />
            <Route path="/results/:draftId" element={<Results />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Box>
        
        <Box 
          component="footer" 
          sx={{ 
            py: 3, 
            px: 2, 
            mt: 'auto',
            backgroundColor: theme.palette.grey[900],
            color: 'white',
            textAlign: 'center'
          }}
        >
          <Typography variant="body2">
            © {new Date().getFullYear()} Retromatic. All rights reserved
          </Typography>
        </Box>
      </Box>
    </Router>
  );
}

export default App;