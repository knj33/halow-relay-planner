import type { Deck } from '../types';
import { sampleDeck } from './sample';

/**
 * Every deck the app can play. The first one is the default (`#/present` and the Present button).
 * To add the real talk: create `decks/<id>.tsx` exporting a `Deck`, then put it first here.
 */
export const DECKS: Deck[] = [sampleDeck];

export function deckById(id: string | null | undefined): Deck | undefined {
  return id ? DECKS.find((d) => d.id === id) : undefined;
}
