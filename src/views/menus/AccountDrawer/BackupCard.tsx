import styled from 'styled-components';

import { colors, icons, motion, radii, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { KeyIcon } from './icons';

/**
 * `AddBackupLoginCard`: shown on the main panel until the recovery phrase has been backed
 * up. Rounded 20, surface1 with a surface3 border, body3 title over body4 subtitle, and the
 * key as the illustration on the right.
 */
const $Card = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.s12};
  width: 100%;
  margin-top: ${spacing.s12};
  padding: 0 ${spacing.s16};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r20};
  background: ${colors.surface1};
  text-align: left;
  transition: border-color ${motion.fast};

  &:hover {
    border-color: ${colors.neutral3};
  }
`;

const $Text = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${spacing.s4};
  padding: ${spacing.s16} 0;

  > strong {
    ${type.body3}
    font-weight: inherit;
    color: ${colors.neutral1};
  }
  > span {
    ${type.body4}
    color: ${colors.neutral2};
  }
`;

const $Art = styled.div`
  display: flex;
  flex: none;
  padding: 9px;
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r12};
  background: ${colors.surface1};
  color: ${colors.accent1};

  > svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
  }
`;

export const BackupCard = ({ onClick }: { onClick: () => void }) => (
  <$Card type="button" onClick={onClick}>
    <$Text>
      <strong>Back up your recovery phrase</strong>
      <span>The 12 words are the only way back into this wallet on another device.</span>
    </$Text>
    <$Art>
      <KeyIcon />
    </$Art>
  </$Card>
);
