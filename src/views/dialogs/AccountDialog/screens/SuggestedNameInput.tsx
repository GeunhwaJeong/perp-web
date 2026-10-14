import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { MAX_NAME_LENGTH, NAME_SUFFIX } from '@/haneul/names';
import styled from 'styled-components';

import { PersonIcon, ShuffleIcon } from '../icons';
import { ErrorText, Label } from '../primitives';
import { colors, motion, radii, spacing, weights } from '../tokens';

/**
 * The value renders at heading3 size and shrinks to fit the row when a long name plus the
 * suffix would overflow; the line height is pinned above the glyph box so an <input>
 * does not clip descenders and the row keeps its height while the size changes.
 */
const VALUE_LINE_HEIGHT = 32;
const MAX_FONT_SIZE = 24;
const MIN_FONT_SIZE = 16;
// Average glyph advance at 24px for this family, used to estimate the fit.
const CHAR_WIDTH_AT_MAX = 14;
// Room for the shuffle button and its padding on the same row.
const TRAILING_WIDTH = 48;

// The shuffle motion: the old name drops, blurs and fades, the swap happens while it is
// invisible, and the new one rises back with the same easing.
const SWAP_FADE_MS = 200;
const SWAP_OFFSET_PX = 12;
const SWAP_BLUR_PX = 4;

const AVATAR_SIZE = 56;
// Error copy aligns with the field text: past the avatar and the 12px gap.
const ERROR_INDENT = AVATAR_SIZE + 12;
// The input box is sized to the measured text, so give the caret room at both ends.
const CARET_SLACK = 2;

const $Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s12};
  width: 100%;
`;

const $Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.s12};
  width: 100%;
  padding-right: ${spacing.s8};
`;

const $Avatar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: ${AVATAR_SIZE}px;
  height: ${AVATAR_SIZE}px;
  border-radius: ${radii.full};
  background: ${colors.accent2};
  color: ${colors.accent1};
`;

const $Field = styled.div<{ $error: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s4};
  flex: 1;
  min-width: 0;
  padding-bottom: ${spacing.s12};
  border-bottom: 1.5px solid ${({ $error }) => ($error ? colors.critical : colors.surface3)};
  cursor: text;
  transition: border-color ${motion.fast};
`;

const $ValueRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.s8};
  width: 100%;
`;

const $Swap = styled.div<{ $hidden: boolean }>`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
  transform: translateY(${({ $hidden }) => ($hidden ? SWAP_OFFSET_PX : 0)}px);
  filter: blur(${({ $hidden }) => ($hidden ? SWAP_BLUR_PX : 0)}px);
  transition:
    opacity ${SWAP_FADE_MS}ms ease-in-out,
    transform ${SWAP_FADE_MS}ms ease-in-out,
    filter ${SWAP_FADE_MS}ms ease-in-out;
`;

const valueFont = (fontSize: number) => `
  font-family: var(--fontFamily-base);
  font-size: ${fontSize}px;
  line-height: ${VALUE_LINE_HEIGHT}px;
  font-weight: ${weights.book};
  letter-spacing: -0.005em;
`;

const $Measure = styled.div<{ $fontSize: number }>`
  position: relative;
  flex-shrink: 1;
  min-width: 12px;
`;

/** The invisible twin: sizes the wrapper to the typed text so the suffix hugs the name. */
const $Twin = styled.span<{ $fontSize: number }>`
  display: block;
  ${({ $fontSize }) => valueFont($fontSize)}
  white-space: pre;
  opacity: 0;
  pointer-events: none;
`;

const $Input = styled.input<{ $fontSize: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: -${CARET_SLACK}px;
  right: -${CARET_SLACK}px;
  width: calc(100% + ${CARET_SLACK * 2}px);
  padding: 0 ${CARET_SLACK}px;
  margin: 0;
  border: 0;
  background: transparent;
  color: ${colors.neutral1};
  outline: none;
  ${({ $fontSize }) => valueFont($fontSize)}

  &::placeholder {
    color: ${colors.neutral3};
  }
`;

const $Suffix = styled.span<{ $fontSize: number }>`
  ${({ $fontSize }) => valueFont($fontSize)}
  color: ${colors.neutral3};
  white-space: nowrap;
  flex: none;
`;

const $Shuffle = styled.button`
  display: inline-flex;
  flex: none;
  padding: ${spacing.s8};
  margin: -${spacing.s8} 0;
  border: 0;
  background: none;
  color: ${colors.neutral2};
  cursor: pointer;
  transition: color ${motion.fast};

  &:hover:not(:disabled) {
    color: ${colors.neutral1};
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

export const SuggestedNameInput = ({
  value,
  onChange,
  onShuffle,
  isShuffling,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onShuffle: () => void;
  isShuffling: boolean;
  error?: string;
  autoFocus?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);

  // The field renders this local copy so external changes (prefill, shuffle) can cross-fade:
  // typing syncs it in the same render, everything else swaps behind the fade.
  const [rendered, setRendered] = useState(value);
  const isFadedOut = value !== rendered;

  useEffect(() => {
    if (!isFadedOut) return undefined;
    const timer = setTimeout(() => setRendered(value), SWAP_FADE_MS);
    return () => clearTimeout(timer);
  }, [isFadedOut, value]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRowWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chars = rendered.length + NAME_SUFFIX.length;
  const available = Math.max(rowWidth - TRAILING_WIDTH, 0);
  const fit =
    chars > 0 && available > 0
      ? (available / chars / CHAR_WIDTH_AT_MAX) * MAX_FONT_SIZE
      : MAX_FONT_SIZE;
  const fontSize = Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fit)));

  return (
    <$Root>
      <$Row>
        {/* A generic avatar: there is no address yet to draw an identicon from. */}
        <$Avatar>
          <PersonIcon size={28} />
        </$Avatar>
        <$Field $error={Boolean(error)} onClick={() => inputRef.current?.focus()}>
          <Label>Name</Label>
          <$ValueRow ref={rowRef}>
            <$Swap $hidden={isFadedOut}>
              <$Measure $fontSize={fontSize}>
                <$Twin $fontSize={fontSize} aria-hidden>
                  {rendered || 'yourname'}
                </$Twin>
                <$Input
                  ref={inputRef}
                  $fontSize={fontSize}
                  value={rendered}
                  placeholder="yourname"
                  // Not a login field: keep password managers (and their key icon, which
                  // paints over the name) away from it.
                  name="haneul-name"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  maxLength={MAX_NAME_LENGTH}
                  autoFocus={autoFocus}
                  onChange={(event) => {
                    const next = event.target.value.toLowerCase();
                    setRendered(next);
                    onChange(next);
                  }}
                />
              </$Measure>
              <$Suffix $fontSize={fontSize}>{NAME_SUFFIX}</$Suffix>
            </$Swap>
            <$Shuffle
              type="button"
              aria-label="Suggest another name"
              disabled={isShuffling}
              onClick={(event) => {
                event.stopPropagation();
                onShuffle();
              }}
            >
              <ShuffleIcon size={24} />
            </$Shuffle>
          </$ValueRow>
        </$Field>
      </$Row>
      {error && <ErrorText $indent={ERROR_INDENT}>{error}</ErrorText>}
    </$Root>
  );
};
