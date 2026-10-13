import {
  Children,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

import { Content, Description, Overlay, Portal, Root, Title } from '@radix-ui/react-dialog';
import styled, { keyframes } from 'styled-components';

import { useDialogArea } from '@/hooks/useDialogArea';

import breakpoints from '@/styles/breakpoints';

import { colors, modal, motion, radii, shadowShort } from './tokens';

/* ------------------------------------------------------------------ shell */

const overlayIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const contentIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const sheetIn = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

const $Overlay = styled(Overlay)`
  position: fixed;
  inset: 0;
  z-index: 2;
  background: rgba(0, 0, 0, 0.6);
  animation: ${overlayIn} ${motion.quick};
`;

const $Content = styled(Content)`
  position: fixed;
  z-index: 3;
  inset: 0;
  margin: auto;
  width: min(${modal.maxWidth}, calc(100vw - 32px));
  height: fit-content;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: ${modal.padding};
  border-radius: ${radii.r16};
  background: ${colors.surface1};
  color: ${colors.neutral1};
  outline: none;
  animation: ${contentIn} ${motion.quick};
  ${shadowShort}

  @media ${breakpoints.mobile} {
    inset: auto 0 0 0;
    margin: 0;
    width: 100%;
    max-height: calc(100dvh - var(--page-header-height, 2.75rem));
    padding: ${modal.sheetPadding};
    padding-bottom: calc(${modal.sheetPadding} + env(safe-area-inset-bottom, 0px));
    border-radius: ${radii.r20} ${radii.r20} 0 0;
    animation: ${sheetIn} ${motion.quickLong};
  }
`;

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The account dialog's shell: Radix Dialog like the rest of the app, drawn to the Spore
 * modal (480 wide, 32 padding, 16 radius, short shadow) and turning into a bottom sheet
 * at the mobile breakpoint. Dismissal is the caller's: pressing outside or Escape only
 * closes when `dismissible` is on, so a half-finished sign-up is not lost to a stray click.
 */
export const AccountModal = ({
  isOpen,
  onClose,
  dismissible = true,
  label,
  children,
}: PropsWithChildren<{
  isOpen: boolean;
  onClose: () => void;
  dismissible?: boolean;
  label: string;
}>) => {
  const { dialogAreaRef } = useDialogArea() ?? { dialogAreaRef: { current: null } };

  return (
    <Root open={isOpen} onOpenChange={(open) => !open && dismissible && onClose()}>
      <Portal container={dialogAreaRef.current ?? undefined}>
        <$Overlay />
        <$Content
          onInteractOutside={(event) => !dismissible && event.preventDefault()}
          onEscapeKeyDown={(event) => !dismissible && event.preventDefault()}
        >
          <Title style={visuallyHidden}>{label}</Title>
          <Description style={visuallyHidden}>{label}</Description>
          {children}
        </$Content>
      </Portal>
    </Root>
  );
};

/* ---------------------------------------------------------- height animator */

const $HeightOuter = styled.div`
  width: 100%;
  overflow: hidden;
  transition: height ${motion.quickLong};
`;

const $HeightInner = styled.div`
  width: 100%;
`;

/**
 * Animates the container between the heights of successive screens. A ResizeObserver on
 * the content drives an explicit pixel height on the wrapper, which snaps back to `auto`
 * once the transition ends so later reflows (an error line appearing) are free.
 */
export const HeightAnimator = ({ children }: PropsWithChildren) => {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const settled = useRef(true);

  useLayoutEffect(() => {
    const outerEl = outer.current;
    const innerEl = inner.current;
    if (!outerEl || !innerEl) return undefined;

    const reduceMotion = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new ResizeObserver(() => {
      const next = innerEl.offsetHeight;
      const current = outerEl.offsetHeight;
      if (reduceMotion || outerEl.style.height === '' || next === current) {
        outerEl.style.height = reduceMotion ? 'auto' : `${next}px`;
        if (reduceMotion) return;
        // First measurement: pin the height once so the next change has a start value.
        requestAnimationFrame(() => {
          if (settled.current) outerEl.style.height = 'auto';
        });
        return;
      }
      settled.current = false;
      outerEl.style.height = `${current}px`;
      // Reading layout commits the start value before the end value is written.
      outerEl.getBoundingClientRect();
      outerEl.style.height = `${next}px`;
    });
    observer.observe(innerEl);

    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'height') return;
      settled.current = true;
      outerEl.style.height = 'auto';
    };
    outerEl.addEventListener('transitionend', onEnd);

    return () => {
      observer.disconnect();
      outerEl.removeEventListener('transitionend', onEnd);
    };
  }, []);

  return (
    <$HeightOuter ref={outer}>
      <$HeightInner ref={inner}>{children}</$HeightInner>
    </$HeightOuter>
  );
};

/* ------------------------------------------------------------------- pager */

const pageIn = (from: number) => keyframes`
  from { opacity: 0; transform: translateX(${from}px); }
  to { opacity: 1; transform: translateX(0); }
`;

const $Page = styled.div<{ $from: number }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  animation: ${({ $from }) => pageIn($from)} ${motion.pager} backwards;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const PAGER_DISTANCE = 24;

/**
 * Shows one child at a time and slides the incoming one in from the side it came from
 * (forward enters from the right, back from the left), the Spore pager's enter lane. The
 * outgoing page unmounts at once; the height animator carries the size change.
 */
export const Pager = ({ index, children }: { index: number; children: ReactNode }) => {
  const previous = useRef(index);
  const [direction, setDirection] = useState(1);

  if (previous.current !== index) {
    setDirection(index > previous.current ? 1 : -1);
    previous.current = index;
  }

  const pages = Children.toArray(children);

  return (
    <HeightAnimator>
      <$Page key={index} $from={direction * PAGER_DISTANCE}>
        {pages[index] ?? null}
      </$Page>
    </HeightAnimator>
  );
};
