import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './AppShell';

const ProductLayout = lazy(() => import('@/product/ProductLayout'));
const ProductOverview = lazy(() => import('@/product/views/OverviewView'));
const ProductProject = lazy(() => import('@/product/views/ProjectView'));
const ProductOpportunities = lazy(() => import('@/product/views/OpportunitiesView'));
const ProductExperiments = lazy(() => import('@/product/views/ExperimentsView'));
const ProductChanges = lazy(() => import('@/product/views/ChangesView'));
const ProductZev = lazy(() => import('@/product/views/ZevView'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const OpportunitiesPage = lazy(() => import('./pages/OpportunitiesPage'));
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
        {/* The product: identical on the web and inside the desktop shell. */}
        <Route element={<ProductLayout />}>
          <Route index element={<ProductOverview />} />
          <Route path="project" element={<ProductProject />} />
          <Route path="opportunities" element={<ProductOpportunities />} />
          <Route path="experiments" element={<ProductExperiments />} />
          <Route path="changes" element={<ProductChanges />} />
          <Route path="zev" element={<ProductZev />} />
        </Route>
        {/* Workspace surfaces: cloud projects, runtime telemetry, billing, team. */}
        <Route path="dashboard" element={<OverviewPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="opportunities/:id" element={<OpportunitiesPage />} />
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
