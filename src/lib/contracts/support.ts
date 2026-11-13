/**
 * Public support contract: POST /api/support/message (api/_lib/handlers/support.js).
 *
 * Signed-out, no tenant data. `faq` answers come from the vetted public
 * knowledge list; `ai` answers are generated from that same list only, and
 * only when the deployment enables it (PUBLIC_SUPPORT_AI_ENABLED and an
 * OpenRouter key) and the shared rate limiter is available.
 */
export type PublicAnswerMode = 'faq' | 'ai';

export interface PublicSupportTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PublicSupportMessageRequest {
  message: string;
  /** The last few turns, oldest first. The server bounds and trims them. */
  history?: PublicSupportTurn[];
  /** Homepage section the visitor was reading, e.g. "hero" or "pricing". */
  page?: string;
}

export interface PublicSupportLink {
  label: string;
  href: string;
}

export interface PublicSupportMessageResponse {
  answer: string;
  mode: PublicAnswerMode;
  topic: string;
  links: PublicSupportLink[];
  contact: string;
  /** Set when a generative answer was attempted and the FAQ answered instead. */
  fallback?: boolean;
}

export const SUPPORT_MESSAGE_MAX_CHARS = 800;

/** UI label for each answer mode. */
export const ANSWER_MODE_LABEL: Record<PublicAnswerMode, string> = {
  faq: 'Guide / FAQ',
  ai: 'AI answer · public info only',
};
