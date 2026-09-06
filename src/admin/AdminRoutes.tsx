import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useSession } from '@/lib/session';
import { FullPageLoader } from '@/brand/BrandLoader';
import { AdminShell } from './AdminShell';

const NotFoundPage = lazy(() => import('@/marketing/NotFoundPage'));
const AdminOverviewPage = lazy(() => import('./pages/AdminOverviewPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminUserPage = lazy(() => import('./pages/AdminUserPage'));
const AdminWorkspacesPage = lazy(() => import('./pages/AdminWorkspacesPage'));
const AdminPricingPage = lazy(() => import('./pages/AdminPricingPage'));
const AdminContentPage = lazy(() => import('./pages/AdminContentPage'));
const AdminFlagsPage = lazy(() => import('./pages/AdminFlagsPage'));
const AdminModelPricingPage = lazy(() => import('./pages/AdminModelPricingPage'));
const AdminAuditPage = lazy(() => import('./pages/AdminAuditPage'));
const AdminAdminsPage = lazy(() => import('./pages/AdminAdminsPage'));

/** Non-admins get a 404, never a hint that the route exists. The server enforces the same rule on every API. */
export default function AdminRoutes() {
  const { me, status } = useSession();
  if (status === 'signed_in' && !me) return <FullPageLoader />;
  if (!me?.isAdmin) return <NotFoundPage />;
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:id" element={<AdminUserPage />} />
        <Route path="workspaces" element={<AdminWorkspacesPage />} />
        <Route path="workspaces/:id" element={<AdminWorkspacesPage />} />
        <Route path="pricing" element={<AdminPricingPage />} />
        <Route path="content" element={<AdminContentPage />} />
        <Route path="flags" element={<AdminFlagsPage />} />
        <Route path="model-pricing" element={<AdminModelPricingPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
        <Route path="admins" element={<AdminAdminsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
