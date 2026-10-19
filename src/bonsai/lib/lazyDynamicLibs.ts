import { weakMapMemoize } from 'reselect';

// must lazy load separately to ensure best-possible tree shaking/static analysis
export const getLazyStargateClient = weakMapMemoize(async () => {
  return (await import('@cosmjs/stargate')).StargateClient;
});
