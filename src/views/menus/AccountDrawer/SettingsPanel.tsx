import styled from 'styled-components';

import { colors, icons, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { AppTheme, AppThemeSystemSetting, type AppThemeSetting } from '@/state/appUiConfigs';

import {
  BellIcon,
  ContrastIcon,
  FaceIdIcon,
  KeyIcon,
  LockIcon,
  MoonIcon,
  PowerIcon,
  SendIcon,
  SlidersIcon,
  SunIcon,
} from './icons';
import {
  SecondaryButton,
  SectionHeader,
  SegmentedControl,
  SettingsRow,
  SettingsToggle,
  SlideOut,
} from './primitives';

/**
 * `SettingsMenu`: sections 24 apart (rows 8 apart within) under a `SlideOutMenu` header,
 * and a secondary "Log out" button at the bottom. Theme is a segmented control on the
 * first row, as Uniswap's `ThemeToggleWithLabel`.
 */
const $Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s24};
  padding: 0 ${spacing.s12};
`;

const $Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s8};
`;

const $ThemeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.s4};

  > span {
    display: flex;
    align-items: center;
    gap: ${spacing.s12};
    ${type.body3}
    color: ${colors.neutral1};

    > svg {
      width: ${icons.i24}px;
      height: ${icons.i24}px;
      color: ${colors.neutral2};
    }
  }
`;

const $LogOut = styled.div`
  display: flex;
  margin-bottom: ${spacing.s8};
`;

export type SettingsPanelProps = {
  isSigmaAccount: boolean;
  biometricEnabled: boolean;
  themeSetting: AppThemeSetting;
  onThemeChange: (next: AppThemeSetting) => void;
  onDisplaySettings: () => void;
  onPreferences: () => void;
  onRecoveryPhrase: () => void;
  onBiometric: (enable: boolean) => void;
  onLock: () => void;
  onSend: () => void;
  onDisconnect: () => void;
  onBack: () => void;
};

export const SettingsPanel = ({
  isSigmaAccount,
  biometricEnabled,
  themeSetting,
  onThemeChange,
  onDisplaySettings,
  onPreferences,
  onRecoveryPhrase,
  onBiometric,
  onLock,
  onSend,
  onDisconnect,
  onBack,
}: SettingsPanelProps) => (
  <SlideOut title="Settings" onBack={onBack}>
    <$Sections>
      <$Section>
        <SectionHeader>Preferences</SectionHeader>
        <$ThemeRow>
          <span>
            <ContrastIcon />
            Theme
          </span>
          <SegmentedControl<AppThemeSetting>
            value={themeSetting === AppTheme.Classic ? AppTheme.Dark : themeSetting}
            onChange={onThemeChange}
            options={[
              { value: AppThemeSystemSetting.System, label: 'Auto' },
              { value: AppTheme.Light, label: <SunIcon /> },
              { value: AppTheme.Dark, label: <MoonIcon /> },
            ]}
          />
        </$ThemeRow>
        <SettingsRow icon={<SlidersIcon />} title="Display" onClick={onDisplaySettings} />
        <SettingsRow icon={<BellIcon />} title="Notifications" onClick={onPreferences} />
      </$Section>

      {isSigmaAccount && (
        <$Section>
          <SectionHeader>Privacy & security</SectionHeader>
          <SettingsRow icon={<KeyIcon />} title="Recovery phrase" onClick={onRecoveryPhrase} />
          <SettingsToggle
            icon={<FaceIdIcon />}
            title="Face ID unlock"
            checked={biometricEnabled}
            onChange={onBiometric}
          />
          <SettingsRow icon={<LockIcon />} title="Lock" showArrow={false} onClick={onLock} />
        </$Section>
      )}

      <$Section>
        <SectionHeader>Advanced</SectionHeader>
        <SettingsRow icon={<SendIcon />} title="Send tokens" onClick={onSend} />
      </$Section>

      <$LogOut>
        <SecondaryButton type="button" onClick={onDisconnect}>
          <PowerIcon />
          Disconnect
        </SecondaryButton>
      </$LogOut>
    </$Sections>
  </SlideOut>
);
