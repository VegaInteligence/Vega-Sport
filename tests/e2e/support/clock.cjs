// A fixed "now" for a local server (the site's dev server, an API double), so that a run on
// recorded data is reproducible: `NODE_OPTIONS="--require tests/e2e/support/clock.cjs" VEGA_NOW=<ISO instant>`.
// The clock starts at VEGA_NOW and runs on from there (timers keep their real pace). Without
// VEGA_NOW it changes nothing. Never loaded in production: test support only.
const start = Date.parse(process.env.VEGA_NOW || "");
if (Number.isFinite(start)) {
  const RealDate = Date,
    offset = start - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(RealDate.now() + offset);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  // Own statics too: a wrapper that copies only own properties (the dev server patches Date) keeps them.
  for (const name of ["parse", "UTC"]) ShiftedDate[name] = RealDate[name];
  globalThis.Date = ShiftedDate;
}
