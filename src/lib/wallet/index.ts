// Formatting
export const truncateAddress = (address?: string, prefix: string = 'dydx') => {
  if (!address) return '';
  // Haneul addresses are hex; keep the 0x marker and drop any bech32 prefix handling.
  const effectivePrefix = address.startsWith('0x') ? '0x' : prefix;
  const hash = address.replace(effectivePrefix, '');
  const firstHalf = hash.slice(0, 4);
  const secondHalf = hash.slice(-4);
  return `${effectivePrefix}${firstHalf}...${secondHalf}`;
};
