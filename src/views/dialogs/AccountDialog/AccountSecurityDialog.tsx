import { useState } from 'react';

import {
  BiometricCancelledError,
  InvalidPasswordError,
  mnemonicWords,
  passwordFromBiometric,
} from '@/haneul/account';

import { AccountSecurityDialogProps, DialogProps } from '@/constants/dialogs';

import { useLocalAccount } from '@/hooks/useLocalAccount';

import { AccountModal, Pager } from './AccountModal';
import { BiometricScreen } from './screens/BiometricScreen';
import { PhraseScreen, PhraseWarningScreen } from './screens/RecoveryPhraseScreens';
import { VerifyScreen } from './screens/VerifyScreen';

const SCREENS = ['warning', 'verify', 'biometric', 'phrase'] as const;
type Screen = (typeof SCREENS)[number];

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof InvalidPasswordError
    ? 'Incorrect password'
    : error instanceof Error && error.message
      ? error.message
      : fallback;

/**
 * The account's security chores, reached from the account menu: show the recovery
 * phrase (warning, re-authenticate, the twelve words) or enrol Face ID (re-authenticate,
 * enrol). Both start by proving the password even though the vault is open, the way the
 * Uniswap extension asks again before anything that could cost the wallet.
 */
export const AccountSecurityDialog = ({
  intent,
  setIsOpen,
}: DialogProps<AccountSecurityDialogProps>) => {
  const { account, store } = useLocalAccount();
  const [screen, setScreen] = useState<Screen>(intent === 'recoveryPhrase' ? 'warning' : 'verify');
  const [password, setPassword] = useState<string>();
  const [words, setWords] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();

  const close = () => setIsOpen(false);

  const go = (next: Screen) => {
    setError(undefined);
    setScreen(next);
  };

  const proceed = async (verifiedPassword: string) => {
    if (intent === 'recoveryPhrase') {
      setWords(mnemonicWords(await store.revealMnemonic(verifiedPassword)));
      go('phrase');
    } else {
      setPassword(verifiedPassword);
      go('biometric');
    }
  };

  const onVerify = async (candidate: string) => {
    setIsPending(true);
    setError(undefined);
    try {
      await store.verifyPassword(candidate);
      await proceed(candidate);
    } catch (verifyError) {
      setError(errorMessage(verifyError, 'Could not verify. Try again.'));
    } finally {
      setIsPending(false);
    }
  };

  const onVerifyWithBiometric = async () => {
    if (!account?.biometric) return;
    setIsPending(true);
    setError(undefined);
    try {
      // The biometric record yields the password itself, which then opens the phrase.
      await proceed(await passwordFromBiometric(account.biometric));
    } catch (verifyError) {
      if (!(verifyError instanceof BiometricCancelledError)) {
        setError(errorMessage(verifyError, 'Face ID did not work. Use your password.'));
      }
    } finally {
      setIsPending(false);
    }
  };

  const onEnableBiometric = async () => {
    if (!password) return;
    setIsPending(true);
    setError(undefined);
    try {
      await store.enableBiometric(password);
      setPassword(undefined);
      close();
    } catch (enrolError) {
      if (!(enrolError instanceof BiometricCancelledError)) {
        setError(errorMessage(enrolError, 'Could not set up Face ID on this device.'));
      }
    } finally {
      setIsPending(false);
    }
  };

  const onDone = () => {
    store.markBackedUp();
    setWords([]);
    close();
  };

  return (
    <AccountModal
      isOpen
      onClose={close}
      dismissible={screen !== 'phrase'}
      label={intent === 'recoveryPhrase' ? 'Recovery phrase' : 'Face ID unlock'}
    >
      <Pager index={SCREENS.indexOf(screen)}>
        <PhraseWarningScreen onView={() => go('verify')} onClose={close} />
        <VerifyScreen
          subtitle={
            intent === 'recoveryPhrase'
              ? 'Enter your password to view the phrase.'
              : 'Enter your password to set up Face ID.'
          }
          canUseBiometric={Boolean(account?.biometric) && intent === 'recoveryPhrase'}
          onVerify={onVerify}
          onVerifyWithBiometric={onVerifyWithBiometric}
          isPending={isPending}
          error={error}
          goBack={intent === 'recoveryPhrase' ? () => go('warning') : undefined}
          onClose={close}
        />
        <BiometricScreen
          onEnable={onEnableBiometric}
          onSkip={close}
          isPending={isPending}
          error={error}
          onClose={close}
        />
        <PhraseScreen words={words} onDone={onDone} onClose={onDone} />
      </Pager>
    </AccountModal>
  );
};
