import type { HTMLAttributes } from 'react';

type StatarenaLogoProps = HTMLAttributes<HTMLImageElement> & {
  layout?: 'symbol' | 'wordmark' | 'horizontal' | 'stacked';
  appearance?: 'color' | 'inverse' | 'navy' | 'white';
};

/** Copy the kit's logos/svg files to public/branding first. */
export function StatarenaLogo({
  layout = 'horizontal',
  appearance = 'color',
  alt = 'STATARENA',
  ...props
}: StatarenaLogoProps) {
  return <img src={`/branding/statarena-${layout}-${appearance}.svg`} alt={alt} {...props} />;
}
