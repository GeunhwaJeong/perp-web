import { useMemo } from 'react';

import { dAppKit, type HaneulNetwork } from '@/haneul/dAppKit';
import {
  checkNameAvailability,
  getNameFormatError,
  NAME_SERVICE_CONFIGS,
  normalizeName,
  type NameAvailability,
} from '@/haneul/names';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { timeUnits } from '@/constants/time';

import { useDebounce } from '@/hooks/useDebounce';

const NAME_CHECK_DEBOUNCE_MS = 300;
// Registrations are rare and the check is three object reads; a short cache keeps shuffle
// and the typed field from re-asking for the same name.
const NAME_CHECK_STALE_MS = 2 * timeUnits.minute;

export const nameAvailabilityQueryOptions = (name: string) => {
  const client = dAppKit.getClient();
  const config = NAME_SERVICE_CONFIGS[client.network as HaneulNetwork];
  return {
    queryKey: ['haneulns', 'availability', client.network, name] as const,
    queryFn: async (): Promise<NameAvailability> => {
      // A network without a name service (localnet) cannot say no, so every name is free.
      if (!config) return 'available';
      return checkNameAvailability({ client, config, name });
    },
    staleTime: NAME_CHECK_STALE_MS,
    retry: false,
  };
};

export const fetchNameAvailability = (queryClient: QueryClient, name: string) =>
  queryClient.fetchQuery(nameAvailabilityQueryOptions(name));

const unavailableMessage: Partial<Record<NameAvailability, string>> = {
  taken: 'Username unavailable.',
  reserved: 'Username unavailable.',
  blocked: 'Username unavailable.',
};

/**
 * Format errors fire immediately; the chain is asked only once typing pauses, and the
 * result is reported as "caught up" so a button can wait for it rather than blink.
 */
export const useNameAvailability = (input: string) => {
  const name = normalizeName(input);
  const formatError = name ? getNameFormatError(name) : undefined;
  const debouncedName = useDebounce(name, NAME_CHECK_DEBOUNCE_MS);
  const isDebouncing = name !== debouncedName;
  const shouldCheck = Boolean(debouncedName) && !formatError && !isDebouncing;

  const query = useQuery({
    ...nameAvailabilityQueryOptions(debouncedName),
    enabled: shouldCheck,
  });

  return useMemo(() => {
    const availability = shouldCheck ? query.data : undefined;
    const error = formatError?.message ?? (availability && unavailableMessage[availability]);
    return {
      name,
      availability,
      error,
      isDebouncing,
      isChecking: shouldCheck && query.isPending,
      isAvailable: !formatError && (availability === 'available' || availability === 'unknown'),
    };
  }, [formatError, isDebouncing, name, query.data, query.isPending, shouldCheck]);
};

export const useNameQueryClient = useQueryClient;
