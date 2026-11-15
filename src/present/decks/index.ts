import type { Deck } from '../types';
import { sampleDeck } from './sample';
import { smmsDeck } from './smms';

/**
 * Every deck the app can play. The first one is the default (`#/present` and the Present button).
 * The SMMS talk is the default; the engine sample stays reachable at `#/present/sample`.
 */
export const DECKS: Deck[] = [smmsDeck, sampleDeck];

export function deckById(id: string | null | undefined): Deck | undefined {
  return id ? DECKS.find((d) => d.id === id) : undefined;
}
