import { useCallback, useEffect, useRef, useState } from 'react';

import { appendRandomDigits, generateNameCandidate } from '@/haneul/names';
import { useQueryClient } from '@tanstack/react-query';

import { fetchNameAvailability } from './useNameAvailability';

// A few vetted names are kept ready so the first fill and each shuffle feel instant.
const PREWARM_QUEUE_TARGET = 3;
// Bounds the chain probes per fill so a run of taken names cannot spin.
const MAX_PROBE_ATTEMPTS = 8;
// After this many misses the pattern widens (noun+noun), then digits are appended.
const NOUN_NOUN_ESCALATION_ATTEMPT = 3;
const DIGIT_ESCALATION_ATTEMPT = 6;

/** Fire-and-forget for background fills; failures surface as "no suggestion", not throws. */
const inBackground = (work: Promise<unknown>) => {
  work.catch(() => undefined);
};

export type SuggestedName = {
  /** The current suggestion without the suffix, or undefined until the first one lands. */
  suggestion: string | undefined;
  /** True until the first available suggestion has been found. */
  isInitializing: boolean;
  /** True while a shuffle waits on a fresh name (only when the vetted queue is empty). */
  isShuffling: boolean;
  shuffle: () => void;
};

/**
 * Generates available usernames for sign-up. Mount it on the screen before the one that
 * shows the field so the first suggestion is ready by the time the user arrives.
 */
export const useSuggestedName = (): SuggestedName => {
  const queryClient = useQueryClient();
  const [suggestion, setSuggestion] = useState<string>();
  const [isShuffling, setIsShuffling] = useState(false);
  const queue = useRef<string[]>([]);
  const filling = useRef(false);
  const mounted = useRef(true);

  const findAvailable = useCallback(
    async (exclude: Set<string>): Promise<string | undefined> => {
      // Probes are sequential on purpose: each miss decides whether the next one escalates.
      // eslint-disable-next-line no-await-in-loop
      for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
        let candidate = generateNameCandidate({
          allowNounNoun: attempt >= NOUN_NOUN_ESCALATION_ATTEMPT,
        });
        if (attempt >= DIGIT_ESCALATION_ATTEMPT) candidate = appendRandomDigits(candidate);
        if (exclude.has(candidate)) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const availability = await fetchNameAvailability(queryClient, candidate);
          if (availability === 'available') return candidate;
        } catch {
          // The chain could not be asked: proceed optimistically so sign-up never stalls
          // on a network blip. The issuer re-checks before writing anything.
          return candidate;
        }
      }
      return undefined;
    },
    [queryClient]
  );

  const fillQueue = useCallback(async () => {
    if (filling.current) return;
    filling.current = true;
    try {
      while (mounted.current && queue.current.length < PREWARM_QUEUE_TARGET) {
        const exclude = new Set(queue.current);
        if (suggestion) exclude.add(suggestion);
        // eslint-disable-next-line no-await-in-loop
        const next = await findAvailable(exclude);
        if (!next) break;
        queue.current.push(next);
      }
    } finally {
      filling.current = false;
    }
  }, [findAvailable, suggestion]);

  const takeNext = useCallback(async () => {
    const queued = queue.current.shift();
    if (queued) {
      setSuggestion(queued);
      inBackground(fillQueue());
      return;
    }
    setIsShuffling(true);
    try {
      const next = await findAvailable(new Set(suggestion ? [suggestion] : []));
      if (mounted.current && next) setSuggestion(next);
    } finally {
      if (mounted.current) setIsShuffling(false);
      inBackground(fillQueue());
    }
  }, [fillQueue, findAvailable, suggestion]);

  useEffect(() => {
    mounted.current = true;
    inBackground(takeNext());
    return () => {
      mounted.current = false;
    };
    // Runs once: the initial fill, then the queue keeps itself warm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shuffle = useCallback(() => {
    inBackground(takeNext());
  }, [takeNext]);

  return { suggestion, isInitializing: suggestion === undefined, isShuffling, shuffle };
};
