import { NAME_TLD } from './config';

/**
 * What a username may look like. HaneulNS itself accepts 3 to 63 characters; the sign-up
 * field stops at 20 so a name still fits on a leaderboard row and in the input at 24px.
 */
export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 20;

const VALID_NAME = /^[a-z0-9]+$/;

export type NameFormatError =
  | { kind: 'tooShort'; message: string }
  | { kind: 'tooLong'; message: string }
  | { kind: 'characters'; message: string }
  | { kind: 'leadingDigit'; message: string };

export const normalizeName = (input: string): string => input.trim().toLowerCase();

export const getNameFormatError = (input: string): NameFormatError | undefined => {
  const name = normalizeName(input);
  if (name.length < MIN_NAME_LENGTH) {
    return { kind: 'tooShort', message: `Usernames need at least ${MIN_NAME_LENGTH} characters` };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { kind: 'tooLong', message: `Usernames can have at most ${MAX_NAME_LENGTH} characters` };
  }
  if (!VALID_NAME.test(name)) {
    return {
      kind: 'characters',
      message: 'Usernames can only contain lowercase letters and numbers',
    };
  }
  if (/^[0-9]/.test(name)) {
    return { kind: 'leadingDigit', message: 'Usernames cannot start with a number' };
  }
  return undefined;
};

export const fullName = (name: string): string => `${name}.${NAME_TLD}`;

export const NAME_SUFFIX = `.${NAME_TLD}`;
