// The logo's asterisk alone, from the wordmark's own outline (src/brand-mark.js): set after a title as after
// « Vega ». The legal pages' titles (Legal.jsx, LegalAsterisk) and the consent banner's title (Consent.jsx).
import { WORDMARK } from "../brand-mark.js";

// The asterisk's box inside the wordmark's drawing.
const SIGN_BOX = "1849 -5 292 326";

export default function BrandAsterisk({ className }) {
  return (
    <svg className={className} viewBox={SIGN_BOX} aria-hidden="true" focusable="false">
      <path d={WORDMARK.sign} />
    </svg>
  );
}
