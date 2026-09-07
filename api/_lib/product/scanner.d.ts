export const SAFE_EXTENSIONS: string[];
export const SKIP_DIRS: string[];
export const MAX_SOURCE_FILE_BYTES: number;
export function containsSecretLikeValue(text: string): boolean;
export function redactSecretLikeValues(text: string): string;
export function isForbiddenName(name: string): boolean;
export function classifyPath(relPath: string): 'ignore' | 'skipped_sensitive' | 'source';
export interface ScannedCall {
  file_path: string;
  line: number;
  provider: string;
  symbol: string | null;
  excerpt: string;
}
export interface ScannedFinding {
  origin: 'static_scan';
  category: string;
  title: string;
  root_cause: string;
  file_path: string;
  line: number;
  symbol: string | null;
  confidence: number;
  risk: string;
  evidence_status: string;
}
export function classifyFinding(context: string, provider: string): { category: string; title: string; root_cause: string; confidence: number; risk: string };
export function scanText(relPath: string, text: string): { calls: ScannedCall[]; findings: ScannedFinding[]; stack: string[] };
export function scanFiles(files: Array<{ path: string; text: string }>): { files_scanned: number; ai_calls: ScannedCall[]; findings: ScannedFinding[]; detected_stack: string[] };
