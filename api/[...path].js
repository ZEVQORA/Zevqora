/**
 * Single Vercel function for the whole ZEVQORA API.
 *
 * Every route is registered by the handler modules below and dispatched by
 * path. Consolidating into one function keeps the deployment within the
 * serverless function budget and gives every route the same auth, error and
 * logging behaviour.
 */
import { dispatch } from './_lib/router.js';
import './_lib/handlers/public.js';
import './_lib/handlers/desktop.js';
import './_lib/handlers/stripe.js';
import './_lib/handlers/cron.js';
import './_lib/handlers/me.js';
import './_lib/handlers/workspaces.js';
import './_lib/handlers/projects.js';
import './_lib/handlers/telemetry.js';
import './_lib/handlers/analysis.js';
import './_lib/handlers/experiments.js';
import './_lib/handlers/admin.js';

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
