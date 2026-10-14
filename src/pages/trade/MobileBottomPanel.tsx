import { useMemo } from 'react';

import { STRING_KEYS } from '@/constants/localization';

import { useStringGetter } from '@/hooks/useStringGetter';

import { MobileTabs } from '@/components/Tabs';
import { CurrentMarketDetails } from '@/views/MarketDetails/CurrentMarketDetails';
import { MarketStatsDetails } from '@/views/MarketStatsDetails';

enum InfoSection {
  Statistics = 'Statistics',
  About = 'About',
}

export const MobileBottomPanel = () => {
  const stringGetter = useStringGetter();

  const items = useMemo(
    () => [
      {
        value: InfoSection.Statistics,
        label: stringGetter({ key: STRING_KEYS.STATISTICS }),
        content: <MarketStatsDetails showMidMarketPrice={false} />,
      },
      {
        value: InfoSection.About,
        label: stringGetter({ key: STRING_KEYS.ABOUT }),
        content: <CurrentMarketDetails />,
      },
    ],
    [stringGetter]
  );

  return <MobileTabs defaultValue={InfoSection.Statistics} items={items} />;
};
