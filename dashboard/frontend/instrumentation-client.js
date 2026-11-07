import { startNavigationAcceptance } from "./src/services/navigation-acceptance.js";

// Explicit ?acceptance=1 only. Recording stays in this document's DOM.
try {
  startNavigationAcceptance();
} catch {
  // Optional diagnostics must never prevent hydration or navigation.
}
