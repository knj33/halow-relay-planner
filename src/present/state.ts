import { create } from 'zustand';
import type { Lang } from './types';

const LANG_KEY = 'halow.present.lang';
function readLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'ka' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The little state the rest of the app needs about the presentation: whether one is open, and
 * whether the current slide is a live slide (the planner shows through and must keep rendering).
 * Navigation state itself lives inside the presenter.
 */
interface PresentationState {
  open: boolean;
  live: boolean;
  deckId: string | null;
  /** Slide (0-based) and step to open at, for deep links. */
  start: { slide: number; step: number };
  openDeck: (deckId: string | null, start?: { slide: number; step: number }) => void;
  close: () => void;
  setLive: (live: boolean) => void;
  /** Chosen presentation language; null until chosen (the deck's first language applies). Remembered per browser. */
  lang: Lang | null;
  setLang: (lang: Lang) => void;
}

export const usePresentation = create<PresentationState>((set) => ({
  open: false,
  live: false,
  deckId: null,
  start: { slide: 0, step: 0 },
  openDeck: (deckId, start = { slide: 0, step: 0 }) => set({ open: true, deckId, start }),
  close: () => set({ open: false, live: false }),
  setLive: (live) => set((s) => (s.live === live ? s : { live })),
  lang: readLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private mode: the choice lasts this session only */
    }
    set({ lang });
  },
}));
