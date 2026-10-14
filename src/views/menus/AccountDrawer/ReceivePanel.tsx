import styled from 'styled-components';

import { QrCode } from '@/components/QrCode';
import { colors, motion, radii, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { SigmaBadgeIcon } from './icons';
import { SlideOut } from './primitives';

/**
 * `ReceiveQRCode`: the name in heading3, a 240 QR with the account mark in a white disc at
 * its centre, and the address in body2 inside a rounded 16 box labelled on its top edge.
 */
const $Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.s12};
  padding: 0 ${spacing.s16} ${spacing.s24};
`;

const $Title = styled.div`
  ${type.heading3}
  color: ${colors.neutral1};
  text-align: center;
`;

const $Qr = styled.div`
  position: relative;
  padding: ${spacing.s12};
  border-radius: ${radii.r20};
  background: ${colors.white};
`;

const $Mark = styled.div`
  position: absolute;
  inset: 50% auto auto 50%;
  display: flex;
  padding: ${spacing.s4};
  border-radius: ${radii.full};
  background: ${colors.white};
  transform: translate(-50%, -50%);
`;

const $AddressBox = styled.button`
  position: relative;
  width: 100%;
  margin-top: ${spacing.s8};
  padding: ${spacing.s16};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r16};
  background: transparent;
  ${type.body2}
  color: ${colors.neutral1};
  word-break: break-all;
  text-align: center;
  transition: opacity ${motion.fast};

  &:hover {
    opacity: 0.75;
  }

  > span {
    position: absolute;
    top: -8px;
    left: 50%;
    padding: 0 ${spacing.s8};
    background: ${colors.surface1};
    ${type.body4}
    color: ${colors.neutral2};
    transform: translateX(-50%);
    white-space: nowrap;
  }
  > span.copied {
    color: ${colors.success};
  }
`;

export const ReceivePanel = ({
  address,
  name,
  onCopy,
  copied,
  onBack,
}: {
  address: string;
  name?: string;
  onCopy: () => void;
  copied: boolean;
  onBack: () => void;
}) => (
  <SlideOut title="Receive" onBack={onBack}>
    <$Body>
      {name && <$Title>{name}.haneul</$Title>}
      <$Qr>
        <QrCode value={address} size={216} />
        <$Mark>
          <SigmaBadgeIcon size={44} />
        </$Mark>
      </$Qr>
      <$AddressBox type="button" onClick={onCopy}>
        <span className={copied ? 'copied' : undefined}>
          {copied ? 'Copied' : 'Your Haneul address'}
        </span>
        {address}
      </$AddressBox>
    </$Body>
  </SlideOut>
);
