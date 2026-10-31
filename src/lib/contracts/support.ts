/** Planned public support server contract — no live endpoint in release. */
export type PublicAnswerMode = 'public_faq' | 'generative' | 'human_ticket';
export interface PublicSupportMessageRequest {
  idempotency_key: string;
  thread_id: string | null;
  message: string;
  public_context: { page: string };
}
export interface PublicSupportMessageResponse {
  thread_id: string;
  answer: string;
  answer_mode: PublicAnswerMode;
  source_refs: string[];
  created_at: string;
}
export interface PublicSupportTicketRequest {
  idempotency_key: string;
  email: string;
  message: string;
  consent_to_contact: boolean;
}
/** This frontend ships vetted local FAQs only; it intentionally sends NO API requests. */
export const PUBLIC_SUPPORT_MODE: PublicAnswerMode = 'public_faq';
