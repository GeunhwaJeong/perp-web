export enum LocalStorageKey {
  // Onboarding / Accounts
  OnboardingHasAcknowledgedTerms = 'dydx.OnboardingHasAcknowledgedTerms',

  // Notifications
  Notifications = 'dydx.Notifications',
  NotificationsLastUpdated = 'dydx.NotificationsLastUpdated',
  AppInitialized = 'dydx.AppInitialized',
  PushNotificationsEnabled = 'dydx.PushNotificationsEnabled',
  PushNotificationsLastUpdated = 'dydx.PushNotificationsLastUpdated',
  NotificationPreferences = 'dydx.NotificationPreferences',

  // UI State
  LastViewedMarket = 'dydx.LastViewedMarket',
  SelectedLocale = 'dydx.SelectedLocale',
  SelectedNetwork = 'dydx.SelectedNetwork',
  SelectedTradeLayout = 'dydx.SelectedTradeLayout',

  // Discoverability
  HasSeenElectionBannerTRUMPWIN = 'dydx.HasSeenElectionBannerTRUMPWIN',

  CustomFlags = 'dydx.CustomFlags',
}

export const LOCAL_STORAGE_VERSIONS = {
  [LocalStorageKey.NotificationPreferences]: 'v2',
  [LocalStorageKey.Notifications]: 'v1',
  [LocalStorageKey.SelectedTradeLayout]: 'v1',
  // TODO: version all localStorage keys
};
