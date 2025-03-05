import { createTheme } from '@mui/material/styles';

// Custom colors inspired by vintage baseball
const primaryColor = {
  light: '#c4c387',
  main: '#ab9c55', // Primary brand color - baseball glove leather
  dark: '#898c47',
  contrastText: '#fff',
};

const secondaryColor = {
  light: '#7eabb9',
  main: '#4b8997', // Secondary brand color - classic baseball blue
  dark: '#3a6b78',
  contrastText: '#fff',
};

const accentColor = {
  light: '#f3b578',
  main: '#ed933c', // Baseball seam color
  dark: '#cc7933',
  contrastText: '#fff',
};

// Create a theme instance
const theme = createTheme({
  palette: {
    primary: primaryColor,
    secondary: secondaryColor,
    error: {
      main: '#f44336',
    },
    background: {
      default: '#f8f9fa',
    },
  },
  typography: {
    fontFamily: [
      'Lato',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif',
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(','),
    h1: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 700,
      color: secondaryColor.main,
    },
    h2: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 700,
    },
    h3: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 600,
    },
    h4: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 600,
    },
    h5: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 600,
    },
    h6: {
      fontFamily: '"Oswald", sans-serif',
      fontWeight: 600,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        },
      },
    },
  },
});

export default theme;