import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  AppBar,
  Box,
  Toolbar,
  IconButton,
  Typography,
  Menu,
  Container,
  Button,
  MenuItem,
  Stack,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Popover,
  Paper,
  useTheme,
  useMediaQuery
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import HelpIcon from '@mui/icons-material/Help';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

interface NavItem {
  label: string;
  subLabel?: string;
  children?: Array<NavItem>;
  href?: string;
  icon?: React.ReactElement;
}

const NAV_ITEMS: Array<NavItem> = [
  {
    label: 'Home',
    href: '/',
    icon: <HomeIcon fontSize="small" />
  },
  {
    label: 'How to Play',
    href: '/how-to-play',
    icon: <HelpIcon fontSize="small" />
  },
  {
    label: 'Leaderboard',
    href: '/leaderboard',
    icon: <EmojiEventsIcon fontSize="small" />
  },
];

export default function Header() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  const handleDrawerToggle = () => {
    setDrawerOpen(!drawerOpen);
  };

  return (
    <AppBar position="static">
      <Container maxWidth="xl">
        <Toolbar disableGutters>
          {/* Mobile menu icon */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, mr: 1 }}>
            <IconButton
              size="large"
              aria-label="open drawer"
              edge="start"
              color="inherit"
              onClick={handleDrawerToggle}
            >
              <MenuIcon />
            </IconButton>
          </Box>
          
          {/* Logo */}
          <Typography
            variant="h6"
            noWrap
            component={RouterLink}
            to="/"
            sx={{
              mr: 2,
              display: 'flex',
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '.1rem',
              color: 'inherit',
              textDecoration: 'none',
              flexGrow: { xs: 1, md: 0 }
            }}
          >
            RETROMATIC
          </Typography>
          
          {/* Desktop navigation */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' }, ml: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.label}
                component={RouterLink}
                to={item.href || '#'}
                sx={{ 
                  color: 'white', 
                  display: 'flex', 
                  alignItems: 'center',
                  mx: 1
                }}
                startIcon={item.icon}
              >
                {item.label}
              </Button>
            ))}
          </Box>
          
          {/* Call to action button */}
          <Button
            component={RouterLink}
            to="/draft"
            variant="contained"
            color="secondary"
            sx={{ 
              display: { xs: 'none', md: 'flex' },
              whiteSpace: 'nowrap'
            }}
          >
            Start Draft
          </Button>
        </Toolbar>
      </Container>
      
      {/* Mobile drawer navigation */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={handleDrawerToggle}
      >
        <Box
          sx={{ width: 250 }}
          role="presentation"
        >
          <List>
            {NAV_ITEMS.map((item) => (
              <ListItem key={item.label} disablePadding>
                <ListItemButton 
                  component={RouterLink} 
                  to={item.href || '#'} 
                  onClick={handleDrawerToggle}
                >
                  <Box sx={{ mr: 2 }}>{item.icon}</Box>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              </ListItem>
            ))}
            <ListItem disablePadding>
              <ListItemButton 
                component={RouterLink} 
                to="/draft" 
                onClick={handleDrawerToggle}
                sx={{ 
                  bgcolor: theme.palette.secondary.main, 
                  color: 'white',
                  '&:hover': {
                    bgcolor: theme.palette.secondary.dark
                  },
                  mt: 2,
                  mx: 2,
                  borderRadius: 1
                }}
              >
                <SportsBaseballIcon sx={{ mr: 1 }} />
                <ListItemText primary="Start Draft" />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
      </Drawer>
    </AppBar>
  );
}