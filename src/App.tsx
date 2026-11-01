import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { FullPageLoader } from '@/brand/BrandLoader';
import { useSession } from '@/lib/session';
import { MarketingLayout } from '@/marketing/MarketingLayout';
import { AccountStateScreen } from '@/auth/AccountStateScreen';
import { installCtaTracking, isWebsitePath, track } from '@/lib/analytics';

const HomePage = lazy(() => import('@/marketing/HomePage'));
const ProductPage = lazy(() => import('@/marketing/ProductPage'));
const HowItWorksPage = lazy(() => import('@/marketing/HowItWorksPage'));
const ProofPage = lazy(() => import('@/marketing/ProofPage'));
const EvaluationPage = lazy(() => import('@/marketing/EvaluationPage'));
const CompanyPage = lazy(() => import('@/marketing/CompanyPage'));
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

/**
 * First-party, cookieless website analytics: a pageview per website route and
 * clicks on elements marked data-cta. Product and admin screens are never sent.
 */
function WebsiteAnalytics() {
  const { pathname } = useLocation();
  useEffect(() => installCtaTracking(), []);
  useEffect(() => {
    if (isWebsitePath(pathname)) track('pageview', { path: pathname });
  }, [pathname]);
  return null;
}

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { status, me, meError, meErrorCode } = useSession();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader label="Checking your session" />;
  if (status === 'unconfigured') return <Navigate to="/login" replace />;
  if (status === 'signed_out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (meErrorCode === 'ACCOUNT_SUSPENDED') return <AccountStateScreen kind="suspended" />;
  // Signed in, but /api/me failed and there is no account to render: say so instead of loading forever.
  if (meError && !me) return <AccountStateScreen kind="load_failed" detail={meError} />;
  return children;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <WebsiteAnalytics />
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route element={<MarketingLayout />}>
            <Route index element={<HomePage />} />
            <Route path="product" element={<ProductPage />} />
            <Route path="how-it-works" element={<HowItWorksPage />} />
            <Route path="technology" element={<Navigate to="/how-it-works" replace />} />
            <Route path="proof" element={<ProofPage />} />
            <Route path="evaluation" element={<EvaluationPage />} />
            <Route path="company" element={<CompanyPage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="privacy" element={<LegalPage kind="privacy" />} />
            <Route path="terms" element={<LegalPage kind="terms" />} />
            <Route path="download" element={<DownloadPage />} />
          </Route>
          <Route path="demo/*" element={<Navigate to="/product" replace />} />
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
