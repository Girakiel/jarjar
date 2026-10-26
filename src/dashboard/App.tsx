import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthPage } from './pages/Auth';
import { FeedbackPage } from './pages/Feedback';
import { InsightsPage } from './pages/Insights';
import { JourneysPage } from './pages/Journeys';
import { PagesPage } from './pages/Pages';
import { Home, NewSitePage, SitesPage } from './pages/Sites';
import { OverviewPage } from './pages/Overview';
import { RecordingsPage } from './pages/Recordings';
import { SettingsPage } from './pages/Settings';
import { SurveyEditorPage } from './pages/SurveyEditor';
import { SurveyResultsPage, SurveysPage } from './pages/Surveys';
import { TestPage } from './pages/Test';

// The replayer pages pull in rrweb, so they're split out of the main bundle.
const ReplayPage = lazy(() => import('./pages/Replay').then((m) => ({ default: m.ReplayPage })));
const HeatmapsPage = lazy(() => import('./pages/Heatmaps').then((m) => ({ default: m.HeatmapsPage })));

interface AuthState {
  user: User | null;
  needsSetup: boolean;
}

const AuthContext = createContext<{ user: User; logout: () => Promise<void> } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside of AuthContext');
  return ctx;
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<AuthState>('/auth/me')
      .then(setAuth)
      .catch((err) => setError(err.message));
    const onUnauthorized = () => setAuth((a) => (a ? { ...a, user: null } : a));
    window.addEventListener('jarjar:unauthorized', onUnauthorized);
    return () => window.removeEventListener('jarjar:unauthorized', onUnauthorized);
  }, []);

  if (error) return <div className="center error-box">Could not reach the jarjar server: {error}</div>;
  if (!auth) return <Spinner />;
  if (!auth.user) {
    return <AuthPage needsSetup={auth.needsSetup} onAuthenticated={(user) => setAuth({ user, needsSetup: false })} />;
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    setAuth({ user: null, needsSetup: false });
  };

  return (
    <AuthContext.Provider value={{ user: auth.user, logout }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sites/new" element={<NewSitePage />} />
          <Route path="/sites" element={<Layout />}>
            <Route index element={<SitesPage />} />
          </Route>
          <Route path="/sites/:siteId" element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="pages" element={<PagesPage />} />
            <Route path="journeys" element={<JourneysPage />} />
            <Route path="recordings" element={<RecordingsPage />} />
            <Route path="recordings/:sessionId" element={<Suspense fallback={<Spinner />}><ReplayPage /></Suspense>} />
            <Route path="heatmaps" element={<Suspense fallback={<Spinner />}><HeatmapsPage /></Suspense>} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="surveys" element={<SurveysPage />} />
            <Route path="surveys/:surveyId" element={<SurveyResultsPage />} />
            <Route path="surveys/:surveyId/edit" element={<SurveyEditorPage />} />
            <Route path="test" element={<TestPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
