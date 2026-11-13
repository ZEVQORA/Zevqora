import { useCallback, useEffect, useRef, useState } from 'react';

export interface SectionSuggestion {
  topic: string;
  text: string;
  question: string;
}

/** Homepage sections that may prompt one quiet suggestion, keyed by selector. */
export const SECTION_SUGGESTIONS: { selector: string; suggestion: SectionSuggestion }[] = [
  { selector: '#product', suggestion: { topic: 'product', text: 'Wondering how your own stack would connect?', question: 'How do I connect my server?' } },
  { selector: '#proof', suggestion: { topic: 'proof', text: 'Curious why every change is verified first?', question: 'Why verify before optimizing?' } },
  { selector: '.engine-boundaries', suggestion: { topic: 'security', text: 'Questions about what happens to your data?', question: 'What happens to my data?' } },
  { selector: '.engine-home-pricing', suggestion: { topic: 'pricing', text: 'Comparing plans?', question: 'How much does it cost?' } },
];

export const MAX_SUGGESTIONS_PER_SESSION = 2;
const STORAGE_KEY = 'zevqora.askzev.suggestions.v1';
const DWELL_MS = 4500;

function readShown(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function writeShown(list: string[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage can be unavailable (private mode); the in-memory cap still applies */
  }
}

/**
 * At most MAX_SUGGESTIONS_PER_SESSION section-aware suggestions per browser
 * session. A suggestion is a labelled hint next to the launcher — never a
 * message in the conversation — and only appears while `enabled` (docked,
 * collapsed, idle, and the visitor has not asked anything yet). Each topic is
 * offered at most once; dismissing counts toward the cap.
 */
export function useSectionSuggestion(enabled: boolean) {
  const [suggestion, setSuggestion] = useState<SectionSuggestion | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const shown = useRef<string[]>([]);
  const timer = useRef(0);

  useEffect(() => {
    shown.current = readShown();
  }, []);

  // Which suggestion-bearing section is most in view; also reported as page context.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const topic = (e.target as HTMLElement).dataset.zevTopic;
          if (topic) ratios.set(topic, e.isIntersecting ? e.intersectionRatio : 0);
        }
        let best: string | null = null;
        let bestRatio = 0.25;
        for (const [topic, r] of ratios) if (r > bestRatio) [best, bestRatio] = [topic, r];
        setSection(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75] },
    );
    for (const { selector, suggestion: s } of SECTION_SUGGESTIONS) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      el.dataset.zevTopic = s.topic;
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!enabled || !section || suggestion) return;
    if (shown.current.length >= MAX_SUGGESTIONS_PER_SESSION || shown.current.includes(section)) return;
    const entry = SECTION_SUGGESTIONS.find((s) => s.suggestion.topic === section);
    if (!entry) return;
    timer.current = window.setTimeout(() => {
      shown.current = [...shown.current, entry.suggestion.topic];
      writeShown(shown.current);
      setSuggestion(entry.suggestion);
    }, DWELL_MS);
    return () => window.clearTimeout(timer.current);
  }, [enabled, section, suggestion]);

  // A suggestion only belongs to the moment it was offered.
  useEffect(() => {
    if (!enabled) setSuggestion(null);
  }, [enabled]);

  const dismiss = useCallback(() => setSuggestion(null), []);
  return { suggestion, section, dismiss };
}
