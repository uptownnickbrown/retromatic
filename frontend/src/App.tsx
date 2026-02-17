import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home } from './pages/Home';
import { Game } from './pages/Game';
import { Results } from './pages/Results';
import { Leaderboard } from './pages/Leaderboard';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminChallengeDetail } from './pages/AdminChallengeDetail';
import { AdminGuard } from './components/admin/AdminGuard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Game />} />
          <Route path="/results/:challengeId" element={<Results />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
          <Route path="/admin/challenge/:id" element={<AdminGuard><AdminChallengeDetail /></AdminGuard>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
