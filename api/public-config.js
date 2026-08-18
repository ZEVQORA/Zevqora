export function GET() {
  return Response.json({
    appUrl: process.env.PUBLIC_APP_URL || 'https://zevqora.vercel.app',
    desktopDownloadUrl: process.env.PUBLIC_DESKTOP_DOWNLOAD_URL || 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe',
    supabaseUrl: process.env.PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.PUBLIC_SUPABASE_ANON_KEY || '',
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_TEAM_PRICE_ID),
    contactEmail: process.env.PUBLIC_CONTACT_EMAIL || 'zevqora.ai@gmail.com',
  }, { headers: { 'cache-control': 'no-store' } });
}
