import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home } from "./pages/Home";
import { Draft } from "./pages/Draft";
import { Results } from "./pages/Results";
import { Leaderboard } from "./pages/Leaderboard";
import { History } from "./pages/History";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
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
          <Route path="/draft/:id" element={<Draft />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
