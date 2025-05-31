// src/App.tsx - Updated for new architecture
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shared/components';
import { AppProvider } from './app/providers';
import { MainLayout } from './app/layouts';

// Import views using new architecture
import { HostApp } from './views/host';
import { PresentationApp } from './views/presentation';
import { TeamApp } from './views/team';

// Legacy pages for routes not yet migrated
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CreateGamePage from './pages/CreateGamePage';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          {/* Authentication routes */}
          <Route path="/login" element={<LoginPage />} />

          {/* Dashboard routes */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/create-game" element={<CreateGamePage />} />

          {/* New architecture routes */}
          <Route path="/classroom/:sessionId" element={
            <AppProvider>
              <MainLayout>
                <HostApp />
              </MainLayout>
            </AppProvider>
          } />

          <Route path="/student-display/:sessionId" element={<PresentationApp />} />
          <Route path="/student-game/:sessionId" element={<TeamApp />} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
