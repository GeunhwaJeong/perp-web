import { NAME_ADJECTIVES, NAME_NOUNS } from './dictionary';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from './format';

/**
 * Suggested names are two words glued together: "amberotter", "quietfjord". The target
 * band keeps them long enough to be free and short enough to read, the retry bound keeps
 * the loop finite when the pools cannot hit the band.
 */
const MIN_TARGET_LENGTH = 8;
const MAX_TARGET_LENGTH = 16;
const MAX_TARGET_RETRIES = 8;
const MAX_APPENDED_DIGITS = 3;

export type RandomSource = () => number;

const pick = <T>(pool: readonly T[], random: RandomSource): T =>
  pool[Math.floor(random() * pool.length)]!;

const isWithin = (value: number, min: number, max: number) => value >= min && value <= max;

export const generateNameCandidate = ({
  random = Math.random,
  allowNounNoun = false,
}: {
  random?: RandomSource;
  allowNounNoun?: boolean;
} = {}): string => {
  let fallback: string | undefined;

  for (let attempt = 0; attempt < MAX_TARGET_RETRIES; attempt += 1) {
    const first =
      allowNounNoun && random() < 0.5 ? pick(NAME_NOUNS, random) : pick(NAME_ADJECTIVES, random);
    const second = pick(NAME_NOUNS, random);
    if (first === second) continue;
    const candidate = `${first}${second}`;
    if (isWithin(candidate.length, MIN_TARGET_LENGTH, MAX_TARGET_LENGTH)) return candidate;
    if (!fallback && isWithin(candidate.length, MIN_NAME_LENGTH, MAX_NAME_LENGTH)) {
      fallback = candidate;
    }
  }

  return fallback ?? `${pick(NAME_ADJECTIVES, random)}${pick(NAME_NOUNS, random)}`;
};

/** Appends one to three digits, trimming the base so the result still fits. */
export const appendRandomDigits = (
  base: string,
  { digits = 1, random = Math.random }: { digits?: number; random?: RandomSource } = {}
): string => {
  const count = Math.min(Math.max(digits, 1), MAX_APPENDED_DIGITS);
  const suffix = Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
  return `${base.slice(0, MAX_NAME_LENGTH - count)}${suffix}`;
};
