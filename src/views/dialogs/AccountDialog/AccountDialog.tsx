import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  BiometricCancelledError,
  createPasskeyAccount,
  InvalidPasswordError,
  isPlatformAuthenticatorAvailable,
  passkeyAccountStore,
  recoverPasskeyAccount,
  SIGMA_ACCOUNT_WALLET_NAME,
  SIGMA_PASSKEY_WALLET_NAME,
} from '@/haneul/account';
import { dAppKit, type HaneulNetwork } from '@/haneul/dAppKit';
import { lookupName, NAME_SERVICE_CONFIGS, requestNameIssue } from '@/haneul/names';

import { DialogProps, OnboardingDialogProps } from '@/constants/dialogs';
import { type WalletInfo } from '@/constants/wallets';

import { useAccounts } from '@/hooks/useAccounts';
import { useLocalAccount } from '@/hooks/useLocalAccount';
import { useSuggestedName } from '@/hooks/useSuggestedName';

import { setDisplayChooseWallet, setOnboardedThisSession } from '@/state/account';
import { calculateOnboardingStep } from '@/state/accountCalculators';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';

import { log } from '@/lib/telemetry';

import { AccountModal, Pager } from './AccountModal';
import { BiometricScreen } from './screens/BiometricScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { CreateScreen } from './screens/CreateScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PasskeyScreen } from './screens/PasskeyScreen';
import { PasswordScreen } from './screens/PasswordScreen';
import { ResetScreen, UnlockScreen } from './screens/UnlockScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';

/**
 * Every screen the dialog can show, in pager order. The order decides the slide
 * direction: moving down the list enters from the right, moving up from the left.
 */
const SCREENS = [
  'unlock',
  'reset',
  'connect',
  'passkey',
  'welcome',
  'create',
  'password',
  'import',
  'importPassword',
  'biometric',
  'complete',
] as const;
type Screen = (typeof SCREENS)[number];

// Screens the dialog must not auto-close out of once the wallet is connected. The passkey
// account connects while the name ('create') or passkey screen is still showing, so those
// are held too; the password account only connects from the password screens.
const HELD_OPEN: ReadonlySet<Screen> = new Set([
  'create',
  'passkey',
  'password',
  'importPassword',
  'biometric',
  'complete',
]);
// Screens where a stray click outside would lose typed input.
const NOT_DISMISSIBLE: ReadonlySet<Screen> = new Set(['password', 'importPassword', 'import']);

const SUCCESS_DISPLAY_MS = 500;

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/** Fire-and-forget: the result is observed through the store, not awaited here. */
const inBackground = (work: Promise<unknown>) => {
  work.catch(() => undefined);
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof InvalidPasswordError
    ? 'Incorrect password'
    : error instanceof Error && error.message
      ? error.message
      : fallback;

/**
 * Sign in, in Uniswap's shape on Sigma's surface: connect an extension, or create the
 * account the site itself keeps (name, password, done), or come back to it. Replaces
 * the dYdX onboarding dialog behind the same `DialogTypes.Onboarding` entry.
 */
export const AccountDialog = ({ setIsOpen: setIsOpenRaw }: DialogProps<OnboardingDialogProps>) => {
  const dispatch = useAppDispatch();
  const currentOnboardingStep = useAppSelector(calculateOnboardingStep);
  const { selectWallet, selectedWallet, selectedWalletError, availableWallets, dydxAddress } =
    useAccounts();
  const { account, status, store } = useLocalAccount();
  const suggested = useSuggestedName();

  const hasLocalAccount = account !== null;
  const [screen, setScreen] = useState<Screen>(() =>
    account && status !== 'unlocked' ? 'unlock' : 'connect'
  );
  const [pendingName, setPendingName] = useState<string>();
  // Which kind of account the create screen's name is for.
  const [mode, setMode] = useState<'local' | 'passkey'>('local');
  const [pendingMnemonic, setPendingMnemonic] = useState<string>();
  // Held only between the password screen and the Face ID offer, then dropped.
  const [pendingPassword, setPendingPassword] = useState<string>();
  const [isWorking, setIsWorking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string>();

  const go = useCallback((next: Screen) => {
    setError(undefined);
    setScreen(next);
  }, []);

  const setIsOpen = useCallback(
    (open: boolean) => {
      if (!open) dispatch(setOnboardedThisSession(true));
      setIsOpenRaw(open);
    },
    [dispatch, setIsOpenRaw]
  );
  const close = useCallback(() => setIsOpen(false), [setIsOpen]);

  useEffect(
    () => () => {
      dispatch(setDisplayChooseWallet(false));
    },
    [dispatch]
  );

  // The dialog closes itself once a wallet is connected, except while it is still walking
  // the user through the end of account creation.
  useEffect(() => {
    if ((!currentOnboardingStep || dydxAddress) && !HELD_OPEN.has(screen)) setIsOpen(false);
  }, [currentOnboardingStep, dydxAddress, screen, setIsOpen]);

  const externalWallets = useMemo(
    () =>
      availableWallets.filter(
        (wallet) =>
          wallet.name !== SIGMA_ACCOUNT_WALLET_NAME && wallet.name !== SIGMA_PASSKEY_WALLET_NAME
      ),
    [availableWallets]
  );
  const passkeyWallet = useMemo(
    () => availableWallets.find((wallet) => wallet.name === SIGMA_PASSKEY_WALLET_NAME),
    [availableWallets]
  );
  const sigmaWallet = useMemo(
    () => availableWallets.find((wallet) => wallet.name === SIGMA_ACCOUNT_WALLET_NAME),
    [availableWallets]
  );

  const connectSigmaWallet = useCallback(async () => {
    if (!sigmaWallet) throw new Error('The Sigma account wallet is not registered');
    await selectWallet(sigmaWallet);
  }, [selectWallet, sigmaWallet]);

  const connectPasskeyWallet = useCallback(async () => {
    if (!passkeyWallet) throw new Error('The Sigma passkey wallet is not registered');
    await selectWallet(passkeyWallet);
  }, [passkeyWallet, selectWallet]);

  /** Writes the chosen name on chain through the issuer; the UI never waits on it. */
  const issueName = useCallback(
    (name: string, address: string, target: 'local' | 'passkey') => {
      requestNameIssue({ name, address })
        .then(() =>
          (target === 'local' ? store : passkeyAccountStore).setName({
            username: name,
            status: 'claimed',
          })
        )
        .catch((issueError: unknown) => log('AccountDialog/issueName', asError(issueError)));
    },
    [store]
  );

  /**
   * A restored account gets its name back from the chain: the primary name it set, or the
   * registration it holds. Nothing to do on a network without a name service.
   */
  const recoverName = useCallback(
    (address: string, target: 'local' | 'passkey') => {
      const client = dAppKit.getClient();
      const config = NAME_SERVICE_CONFIGS[client.network as HaneulNetwork];
      if (!config) return;
      lookupName({ client, config, address })
        .then(
          (name) =>
            name &&
            (target === 'local' ? store : passkeyAccountStore).setName({
              username: name,
              status: 'claimed',
            })
        )
        .catch((lookupError: unknown) => log('AccountDialog/recoverName', asError(lookupError)));
    },
    [store]
  );

  const finish = useCallback(
    async (work: () => Promise<void>, password?: string) => {
      setIsWorking(true);
      setError(undefined);
      try {
        await work();
        setIsSuccess(true);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SUCCESS_DISPLAY_MS);
        });
        setIsSuccess(false);
        // Offer Face ID only where the platform can do it; otherwise straight to done.
        if (password && (await isPlatformAuthenticatorAvailable())) {
          setPendingPassword(password);
          go('biometric');
        } else {
          go('complete');
        }
      } catch (workError) {
        setError(errorMessage(workError, 'Something went wrong. Try again.'));
      } finally {
        setIsWorking(false);
      }
    },
    [go]
  );

  const onCreate = (password: string) =>
    finish(async () => {
      const username = pendingName;
      await store.create({ username, password });
      await connectSigmaWallet();
      const address = store.address;
      if (username && address) issueName(username, address, 'local');
    }, password);

  // Takes the name as an argument: it is called from the same handler that stores it, so
  // reading `pendingName` here would see the previous render's value.
  const onCreatePasskey = (username?: string) =>
    finish(async () => {
      const record = await createPasskeyAccount(username);
      passkeyAccountStore.set(record);
      await connectPasskeyWallet();
      if (username) issueName(username, record.address, 'passkey');
    });

  const onRecoverPasskey = () =>
    finish(async () => {
      const record = await recoverPasskeyAccount();
      passkeyAccountStore.set(record);
      await connectPasskeyWallet();
      recoverName(record.address, 'passkey');
    });

  const onImport = (password: string) =>
    finish(async () => {
      if (!pendingMnemonic) throw new Error('No recovery phrase');
      await store.import({ mnemonic: pendingMnemonic, password });
      setPendingMnemonic(undefined);
      await connectSigmaWallet();
      if (store.address) recoverName(store.address, 'local');
    }, password);

  const onEnableBiometric = async () => {
    if (!pendingPassword) return;
    setIsWorking(true);
    setError(undefined);
    try {
      await store.enableBiometric(pendingPassword);
      setPendingPassword(undefined);
      go('complete');
    } catch (enrolError) {
      if (!(enrolError instanceof BiometricCancelledError)) {
        setError(errorMessage(enrolError, 'Could not set up Face ID on this device.'));
      }
    } finally {
      setIsWorking(false);
    }
  };

  const onSkipBiometric = () => {
    setPendingPassword(undefined);
    go('complete');
  };

  const onUnlock = async (password: string) => {
    setIsWorking(true);
    setError(undefined);
    try {
      await store.unlockWithPassword(password);
      await connectSigmaWallet();
    } catch (unlockError) {
      setError(errorMessage(unlockError, 'Could not unlock. Try again.'));
    } finally {
      setIsWorking(false);
    }
  };

  const onUnlockWithBiometric = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      await store.unlockWithBiometric();
      await connectSigmaWallet();
    } catch (unlockError) {
      if (!(unlockError instanceof BiometricCancelledError)) {
        setError(errorMessage(unlockError, 'Face ID did not work. Use your password.'));
      }
    } finally {
      setIsWorking(false);
    }
  };

  const passkeyRecord = passkeyAccountStore.getSnapshot();
  const completed =
    mode === 'passkey' && passkeyRecord
      ? passkeyRecord
      : {
          username: account?.username,
          address: account?.address ?? '',
          nameStatus: account?.nameStatus,
        };

  const onSelectWallet = (wallet: WalletInfo) => {
    if (isWorking) return;
    inBackground(selectWallet(wallet));
  };

  const index = SCREENS.indexOf(screen);

  return (
    <AccountModal
      isOpen
      onClose={close}
      dismissible={!NOT_DISMISSIBLE.has(screen)}
      label="Sign in to Sigma"
    >
      <Pager index={index}>
        <UnlockScreen
          username={account?.username}
          canUseBiometric={Boolean(account?.biometric)}
          onUnlock={onUnlock}
          onUnlockWithBiometric={onUnlockWithBiometric}
          onForgotPassword={() => go('reset')}
          onUseAnotherWallet={() => go('connect')}
          isPending={isWorking}
          error={error}
          onClose={close}
        />
        <ResetScreen
          onReset={() => {
            store.reset();
            inBackground(selectWallet(undefined));
            go('import');
          }}
          goBack={() => go('unlock')}
          onClose={close}
        />
        <ConnectScreen
          wallets={externalWallets}
          onSelectWallet={onSelectWallet}
          connectingWallet={selectedWallet}
          error={selectedWalletError}
          onCreateAccount={() => {
            setMode('local');
            go('welcome');
          }}
          onLogIn={() => go(hasLocalAccount ? 'unlock' : 'import')}
          onPasskey={() => {
            setMode('passkey');
            go('passkey');
          }}
          hasLocalAccount={hasLocalAccount}
        />
        <PasskeyScreen
          onCreate={() => go('create')}
          onRecover={onRecoverPasskey}
          isPending={isWorking}
          error={error}
          goBack={() => go('connect')}
          onClose={close}
        />
        <WelcomeScreen onContinue={() => go('create')} onClose={close} />
        <CreateScreen
          suggested={suggested}
          initialName={pendingName}
          onContinue={(name) => {
            setPendingName(name);
            if (mode === 'passkey') {
              inBackground(onCreatePasskey(name));
            } else {
              go('password');
            }
          }}
          isPending={mode === 'passkey' && isWorking}
          goBack={() => go(mode === 'passkey' ? 'passkey' : 'welcome')}
          onClose={close}
        />
        <PasswordScreen
          onSubmit={onCreate}
          isPending={isWorking}
          isSuccess={isSuccess}
          error={error}
          goBack={() => go('create')}
        />
        <ImportScreen
          onContinue={(mnemonic) => {
            setPendingMnemonic(mnemonic);
            go('importPassword');
          }}
          goBack={() => go('connect')}
          onClose={close}
        />
        <PasswordScreen
          subtitle="Set the password that will unlock the restored wallet on this device."
          submitLabel="Restore wallet"
          pendingLabel="Restoring wallet"
          successLabel="Wallet restored"
          onSubmit={onImport}
          isPending={isWorking}
          isSuccess={isSuccess}
          error={error}
          goBack={() => go('import')}
        />
        <BiometricScreen
          onEnable={onEnableBiometric}
          onSkip={onSkipBiometric}
          isPending={isWorking}
          error={error}
        />
        <CompleteScreen
          kind={mode === 'passkey' ? 'passkey' : 'password'}
          username={completed.username}
          address={completed.address}
          nameStatus={completed.nameStatus}
          onDone={close}
          onBackUp={close}
        />
      </Pager>
    </AccountModal>
  );
};
