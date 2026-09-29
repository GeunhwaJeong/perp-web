import { ReactNode } from 'react';

import { DAppKitProvider } from '@haneullabs/dapp-kit-react';

import { dAppKit } from './dAppKit';

export const HaneulWalletProvider = ({ children }: { children?: ReactNode }) => (
  <DAppKitProvider dAppKit={dAppKit}>{children}</DAppKitProvider>
);
