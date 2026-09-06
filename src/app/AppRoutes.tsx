import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './AppShell';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const OpportunitiesPage = lazy(() => import('./pages/OpportunitiesPage'));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage'));
const ExperimentPage = lazy(() => import('./pages/ExperimentPage'));
const RunsPage = lazy(() => import('./pages/RunsPage'));
const EvidencePage = lazy(() => import('./pages/EvidencePage'));
const RuntimePage = lazy(() => import('./pages/RuntimePage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="onboarding" element={<OnboardingPage />} />
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="opportunities" element={<OpportunitiesPage />} />
        <Route path="opportunities/:id" element={<OpportunitiesPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="experiments/:id" element={<ExperimentPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="runtime" element={<RuntimePage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ExperimentPage report />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
        <Route path="docs" element={<DocsPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
    </Routes>
  );
}
