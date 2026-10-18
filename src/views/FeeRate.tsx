import { Output, OutputType } from '@/components/Output';

/** A fee rate; once a discount lowers it, the undiscounted rate is struck through before it. */
export const FeeRate = ({
  rate,
  before,
  className,
}: {
  rate: number | undefined;
  before?: number;
  className?: string;
}) =>
  before != null && rate != null && before !== rate ? (
    <span className={className} tw="inline-flex gap-0.5">
      <Output tw="text-color-text-0 line-through" type={OutputType.SmallPercent} value={before} />{' '}
      <Output tw="text-color-accent" type={OutputType.SmallPercent} value={rate} />
    </span>
  ) : (
    <Output className={className} type={OutputType.SmallPercent} value={rate} />
  );
