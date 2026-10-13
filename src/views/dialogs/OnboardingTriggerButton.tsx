import { OnboardingState } from '@/constants/account';
import { ButtonAction, ButtonShape, ButtonSize, ButtonType } from '@/constants/buttons';

import useOnboardingFlow from '@/hooks/Onboarding/useOnboardingFlow';
import { useLocalAccount } from '@/hooks/useLocalAccount';
import { useSimpleUiEnabled } from '@/hooks/useSimpleUiEnabled';

import { Button } from '@/components/Button';

type OnboardingTriggerButtonProps = {
  onClick?: () => void;
};

type StyleProps = {
  className?: string;
  size?: ButtonSize;
  shape?: ButtonShape;
};

/**
 * The header's call to action. "Get started" for a visitor, "Log in" when this browser
 * already holds an account that is locked, the Uniswap pairing, in the app's own
 * rounded-rectangle button.
 */
export const OnboardingTriggerButton = ({
  onClick,
  className,
  shape = ButtonShape.Rectangle,
  size = ButtonSize.Small,
}: OnboardingTriggerButtonProps & StyleProps) => {
  const isSimpleUi = useSimpleUiEnabled();
  const { account, status } = useLocalAccount();
  const { openOnboardingDialog, onboardingState, isAccountViewOnly, isOnboardingDisabled } =
    useOnboardingFlow({ onClick });

  const hasLockedAccount = account !== null && status !== 'unlocked';

  const label =
    onboardingState === OnboardingState.AccountConnected
      ? isAccountViewOnly
        ? 'Unavailable'
        : 'Log in'
      : onboardingState === OnboardingState.WalletConnected
        ? 'Reconnect'
        : hasLockedAccount
          ? 'Log in'
          : 'Get started';

  return (
    <Button
      className={className}
      action={isSimpleUi ? ButtonAction.SimplePrimary : ButtonAction.Primary}
      shape={shape}
      size={size}
      type={ButtonType.Button}
      state={{
        isDisabled: isOnboardingDisabled,
      }}
      onClick={openOnboardingDialog}
    >
      {label}
    </Button>
  );
};
