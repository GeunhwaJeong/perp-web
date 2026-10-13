/* eslint-disable max-classes-per-file -- one tiny error type per failure mode of the vault */
export class InvalidPasswordError extends Error {
  constructor() {
    super('Incorrect password');
    this.name = 'InvalidPasswordError';
  }
}

export class NoAccountError extends Error {
  constructor() {
    super('No account on this device');
    this.name = 'NoAccountError';
  }
}

export class AccountLockedError extends Error {
  constructor() {
    super('Account is locked');
    this.name = 'AccountLockedError';
  }
}

export class BiometricUnavailableError extends Error {
  constructor() {
    super('No platform authenticator on this device');
    this.name = 'BiometricUnavailableError';
  }
}

export class BiometricCancelledError extends Error {
  constructor() {
    super('Biometric prompt was dismissed');
    this.name = 'BiometricCancelledError';
  }
}
