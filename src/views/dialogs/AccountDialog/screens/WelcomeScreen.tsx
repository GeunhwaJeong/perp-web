import { useMemo } from 'react';

import styled, { keyframes } from 'styled-components';

import { ASSET_ICON_MAP } from '@/constants/assets';

import { SigmaMarkIcon } from '../icons';
import { BrandedButton, Column, ScreenFrame, Subtext } from '../primitives';
import { colors, radii, spacing } from '../tokens';

const TOKEN_SIZE = 40;
const TOKEN_GAP = 32;
// Long enough that the duplicated strip is always wider than the modal, so the loop never shows a seam.
const CAROUSEL_TOKENS: readonly (keyof typeof ASSET_ICON_MAP)[] = [
  'BTC',
  'ETH',
  'SOL',
  'USDC',
  'DOGE',
  'AVAX',
  'LINK',
  'ARB',
  'ADA',
  'XRP',
  'LTC',
];

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`;

const $Carousel = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  opacity: 0.5;
  height: ${TOKEN_SIZE}px;
  margin: auto 0;

  /* Fades the strip out at both edges into the modal surface. */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
      90deg,
      ${colors.surface1} 0%,
      transparent 40%,
      transparent 60%,
      ${colors.surface1} 100%
    );
  }
`;

const $Strip = styled.div`
  display: flex;
  position: absolute;
  top: 0;
  left: 0;
  animation: ${scroll} 90s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const $Token = styled.img`
  width: ${TOKEN_SIZE}px;
  height: ${TOKEN_SIZE}px;
  margin-right: ${TOKEN_GAP}px;
  border-radius: ${radii.full};
  flex: none;
`;

const shuffle = <T,>(items: readonly T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

const TokenCarousel = () => {
  const tokens = useMemo(() => shuffle(CAROUSEL_TOKENS), []);
  const strip = tokens.map((symbol) => <$Token key={symbol} src={ASSET_ICON_MAP[symbol]} alt="" />);
  return (
    <$Carousel aria-hidden>
      <$Strip>
        {strip}
        {strip}
      </$Strip>
    </$Carousel>
  );
};

const $Header = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 72px;
`;

const $Card = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${spacing.s12};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r16};
  background: ${colors.surface1};
  color: ${colors.accent1};
  /* Two layers of accent-tinted shadow and a blur, as on the unicorn card. */
  filter: drop-shadow(0 1.8px 3.6px rgba(119, 116, 255, 0.1))
    drop-shadow(0 7.2px 21.6px rgba(119, 116, 255, 0.1));
  backdrop-filter: blur(10.8px);
`;

export const WelcomeScreen = ({
  onContinue,
  onClose,
}: {
  onContinue: () => void;
  onClose: () => void;
}) => (
  <ScreenFrame
    title="Welcome to Sigma"
    subtext={
      // Narrow enough that the line breaks after "seconds", as on the mock.
      <Subtext $maxWidth={254}>Create an account in seconds and trade perps with one name.</Subtext>
    }
    header={
      <$Header>
        <TokenCarousel />
        <$Card>
          <SigmaMarkIcon size={48} />
        </$Card>
      </$Header>
    }
    onClose={onClose}
    gap={spacing.s24}
  >
    <Column>
      <BrandedButton size="large" onClick={onContinue} autoFocus>
        Continue
      </BrandedButton>
    </Column>
  </ScreenFrame>
);
