import { createStoreEffect } from '@/bonsai/lib/createStoreEffect';
import { ResourceCacheManager } from '@/bonsai/lib/resourceCacheManager';
import { logBonsaiError } from '@/bonsai/logs';
import { PerpIndexerClient } from '@/haneul/perp';
import type { CompositeClient } from '@dydxprotocol/v4-client-js';

import { DydxNetwork, ENVIRONMENT_CONFIG_MAP } from '@/constants/networks';

import { type AppDispatch, type RootStore } from '@/state/_store';
import { getSelectedNetwork } from '@/state/appSelectors';
import { setNetworkStateRaw } from '@/state/raw';

import { withRetry } from '@/lib/asyncUtils';

type ClientState<ClientType> = {
  dead: boolean;
  client: ClientType | undefined;
  // contains awaitable promise
  deferred: Deferred<ClientType>;
  currentOperationId: number;
};

export type CompositeClientWrapper = {
  dead?: boolean;
  // makes dead
  tearDown: () => void;
  refreshConnections: () => void;

  compositeClient: ClientState<CompositeClient>;
  indexer: ClientState<PerpIndexerClient>;
};

function makeCompositeClient({
  network,
  dispatch,
}: {
  network: DydxNetwork;
  dispatch: AppDispatch;
}): CompositeClientWrapper {
  const networkConfig = ENVIRONMENT_CONFIG_MAP[network];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!networkConfig) {
    throw new Error(`Unknown network: ${network}`);
  }

  async function initializeIndexerClient() {
    const indexerUrl = networkConfig.endpoints.indexers[0];
    if (indexerUrl == null) {
      throw new Error('No indexer urls found');
    }
    return new PerpIndexerClient(indexerUrl.api, indexerUrl.socket);
  }

  return initializeClientWrapper(dispatch, network, initializeIndexerClient);
}

export const CompositeClientManager = new ResourceCacheManager({
  constructor: (config: { network: DydxNetwork; dispatch: AppDispatch }) =>
    makeCompositeClient(config),
  destroyer: (instance) => {
    instance.tearDown();
  },
  // store not part of serialization, assumed immutable
  keySerializer: ({ network }) => network,
});

// this just makes things simpler
export function alwaysUseCurrentNetworkClient(store: RootStore) {
  return createStoreEffect(store, getSelectedNetwork, (network) => {
    CompositeClientManager.use({ network, dispatch: store.dispatch });
    return () => {
      CompositeClientManager.markDone({ network, dispatch: store.dispatch });
    };
  });
}

function makeClientManager<ClientType>(args: {
  load: () => Promise<ClientType>;
  onSuccess: (version: number, result: ClientType) => void;
  onError: (e?: any) => void;
}): {
  clientState: ClientState<ClientType>;
  load: () => void;
  tearDown: () => void;
} {
  // mutable, stable reference
  const clientState: ClientState<ClientType> = {
    dead: false,
    client: undefined,
    currentOperationId: 0,
    deferred: createDeferred<ClientType>(),
  };

  const load = async () => {
    if (clientState.dead) {
      return;
    }

    clientState.currentOperationId += 1;
    const myId = clientState.currentOperationId;

    if (clientState.deferred.state.settled) {
      clientState.deferred = createDeferred<ClientType>();
    }

    try {
      const client = await withRetry(() => {
        if (clientState.dead || clientState.currentOperationId !== myId) {
          throw new Error('Client dead or operation preempted');
        }
        return args.load();
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (clientState.dead || clientState.currentOperationId !== myId) {
        return;
      }
      clientState.client = client;
      clientState.deferred.resolve(client);
      args.onSuccess(myId, client);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (clientState.dead || clientState.currentOperationId !== myId) {
        return;
      }
      clientState.client = undefined;
      clientState.deferred.reject(e);
      args.onError(e);
    }
  };

  return {
    clientState,
    load,
    tearDown: () => {
      clientState.dead = true;
      const tearDownError = new Error('client tear down');
      clientState.deferred.reject(tearDownError);
      // we assume wrapper will manage this
      // args.onError(tearDownError);
    },
  };
}

/**
 * The dYdX validator client talks to a chain this app does not run on, so it is never created:
 * its state stays empty and the staking queries built on it stay idle instead of failing. Chain
 * reads and writes go through the Haneul gRPC client (src/haneul).
 */
function idleClientState<ClientType>(): ClientState<ClientType> {
  return {
    dead: false,
    client: undefined,
    currentOperationId: 0,
    deferred: createDeferred<ClientType>(),
  };
}

function initializeClientWrapper(
  dispatch: AppDispatch,
  network: DydxNetwork,
  loadIndexer: () => Promise<PerpIndexerClient>
) {
  dispatch(
    setNetworkStateRaw({
      networkId: network,
      stateToMerge: {
        compositeClientReady: false,
        indexerClientReady: false,
      },
    })
  );

  const indexer = makeClientManager({
    load: loadIndexer,
    onSuccess: () =>
      dispatch(
        setNetworkStateRaw({
          networkId: network,
          stateToMerge: { indexerClientReady: true },
        })
      ),
    onError: (e) => {
      logBonsaiError('CompositeClientManager', 'error initializing indexer client', { error: e });
      dispatch(
        setNetworkStateRaw({
          networkId: network,
          stateToMerge: { indexerClientReady: false, errorInitializing: true },
        })
      );
    },
  });
  const compositeClient = idleClientState<CompositeClient>();

  const clientWrapper: CompositeClientWrapper = {
    dead: false,
    compositeClient,
    indexer: indexer.clientState,
    tearDown: () => {
      clientWrapper.dead = true;
      indexer.tearDown();
      compositeClient.dead = true;
      dispatch(
        setNetworkStateRaw({
          networkId: network,
          stateToMerge: {
            compositeClientReady: false,
            indexerClientReady: false,
          },
        })
      );
    },
    refreshConnections: () => {
      // The indexer client holds no connection to refresh.
    },
  };
  indexer.load();
  return clientWrapper;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: Error) => void;
  state: { settled: boolean };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: Error) => void;
  const state = { settled: false };

  const promise = new Promise<T>((res, rej) => {
    resolve = (value: T) => {
      state.settled = true;
      res(value);
    };
    reject = (error?: Error) => {
      state.settled = true;
      rej(error);
    };
  });

  return { promise, resolve, reject, state };
}
