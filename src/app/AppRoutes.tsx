import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './AppShell';

const ProductLayout = lazy(() => import('@/product/ProductLayout'));
const ProductOverview = lazy(() => import('@/product/views/OverviewView'));
const ProductProject = lazy(() => import('@/product/views/ProjectView'));
const ProductOpportunities = lazy(() => import('@/product/views/OpportunitiesView'));
const ProductExperiments = lazy(() => import('@/product/views/ExperimentsView'));
const ProductEvidence = lazy(() => import('@/product/views/EvidenceView'));
const ProductSavings = lazy(() => import('@/product/views/SavingsView'));
const ProductChanges = lazy(() => import('@/product/views/ChangesView'));
const ProductConnections = lazy(() => import('@/product/views/ConnectionsView'));
const ProductZev = lazy(() => import('@/product/views/ZevView'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));

/** Paths from the retired telemetry-era pages, kept so old links and bookmarks still land somewhere useful. */
const RETIRED: Array<[string, string]> = [
  ['dashboard', '/app'],
  ['projects', '/app/project'],
  ['runs', '/app/experiments'],
  ['runtime', '/app/connections'],
  ['reports', '/app/evidence'],
  ['reports/:id', '/app/evidence'],
  ['experiments/:id', '/app/experiments'],
  ['opportunities/:id', '/app/opportunities'],
];

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
          <Route path="evidence" element={<ProductEvidence />} />
          <Route path="savings" element={<ProductSavings />} />
          <Route path="changes" element={<ProductChanges />} />
          <Route path="connections" element={<ProductConnections />} />
          <Route path="zev" element={<ProductZev />} />
        </Route>
        {/* Workspace surfaces: team, billing, settings. */}
        <Route path="usage" element={<UsagePage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
        <Route path="docs" element={<DocsPage />} />
        {RETIRED.map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
    </Routes>
  );
}
