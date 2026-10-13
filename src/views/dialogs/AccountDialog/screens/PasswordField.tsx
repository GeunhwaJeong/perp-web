import { forwardRef, useState, type InputHTMLAttributes } from 'react';

import styled from 'styled-components';

import { Icon, IconName } from '@/components/Icon';

import { colors, motion, radii, spacing, type } from '../tokens';

const $Wrap = styled.div<{ $error?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 56px;
  border: 1px solid ${({ $error }) => ($error ? colors.critical : colors.surface3)};
  border-radius: ${radii.r16};
  background: ${colors.surface1};
  transition: border-color ${motion.fast};

  &:focus-within {
    border-color: ${({ $error }) => ($error ? colors.critical : colors.accent1)};
  }
`;

const $Input = styled.input`
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 ${spacing.s16};
  border: 0;
  background: transparent;
  color: ${colors.neutral1};
  outline: none;
  ${type.body2}

  &::placeholder {
    color: ${colors.neutral3};
  }
`;

const $Eye = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 100%;
  border: 0;
  background: none;
  color: ${colors.neutral3};
  cursor: pointer;
  font-size: 18px;

  &:hover {
    color: ${colors.neutral1};
  }
`;

export const MIN_PASSWORD_LENGTH = 8;

/** The password input of the lock and create screens, with the reveal toggle. */
export const PasswordField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { error?: boolean }
>(({ error, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <$Wrap $error={error}>
      <$Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      <$Eye
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon iconName={visible ? IconName.Hide : IconName.Show} />
      </$Eye>
    </$Wrap>
  );
});
PasswordField.displayName = 'PasswordField';

/** A short, honest read on password strength: length, then variety. */
export const passwordStrength = (password: string): 'weak' | 'fair' | 'strong' | undefined => {
  if (!password) return undefined;
  if (password.length < MIN_PASSWORD_LENGTH) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password)
  ).length;
  if (password.length >= 12 && classes >= 3) return 'strong';
  return 'fair';
};
