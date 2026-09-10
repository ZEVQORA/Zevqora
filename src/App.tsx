import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import { FullPageLoader } from '@/brand/BrandLoader';
import { useSession } from '@/lib/session';
import { MarketingLayout } from '@/marketing/MarketingLayout';

const HomePage = lazy(() => import('@/marketing/HomePage'));
const PricingPage = lazy(() => import('@/marketing/PricingPage'));
const SecurityPage = lazy(() => import('@/marketing/SecurityPage'));
const TeamPage = lazy(() => import('@/marketing/TeamPage'));
const LegalPage = lazy(() => import('@/marketing/LegalPage'));
const DownloadPage = lazy(() => import('@/marketing/DownloadPage'));
const LoginPage = lazy(() => import('@/auth/LoginPage'));
const SignupPage = lazy(() => import('@/auth/SignupPage'));
const ForgotPasswordPage = lazy(() => import('@/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/auth/ResetPasswordPage'));
const AuthCallbackPage = lazy(() => import('@/auth/AuthCallbackPage'));
const DesktopAuthPage = lazy(() => import('@/auth/DesktopAuthPage'));
const InvitePage = lazy(() => import('@/auth/InvitePage'));
const AppRoutes = lazy(() => import('@/app/AppRoutes'));
const AdminRoutes = lazy(() => import('@/admin/AdminRoutes'));
const NotFoundPage = lazy(() => import('@/marketing/NotFoundPage'));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, hash]);
  return null;
}

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { status, meError } = useSession();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader label="Checking your session" />;
  if (status === 'unconfigured') return <Navigate to="/login" replace />;
  if (status === 'signed_out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (meError && /suspended/i.test(meError)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
        <p className="text-body max-w-[46ch] text-muted">{meError}</p>
      </div>
    );
  }
  return children;
}

export function App() {
  return (
    <>
      <Analytics />
      <ScrollToTop />
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route element={<MarketingLayout />}>
            <Route index element={<HomePage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="privacy" element={<LegalPage kind="privacy" />} />
            <Route path="terms" element={<LegalPage kind="terms" />} />
            <Route path="download" element={<DownloadPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route path="desktop-auth" element={<DesktopAuthPage />} />
          <Route path="invite/:token" element={<InvitePage />} />
          <Route path="account" element={<Navigate to="/app/settings" replace />} />
          <Route
            path="app/*"
            element={
              <RequireAuth>
                <AppRoutes />
              </RequireAuth>
            }
          />
          <Route
            path="admin/*"
            element={
              <RequireAuth>
                <AdminRoutes />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
