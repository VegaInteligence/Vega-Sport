/**
 * The logo, in the two colours of the charter (docs/brand/README.md): ivory on the dark theme,
 * night on the light one. "horizontal" is the wordmark « Vega Sport. », "symbol" the mark « V. ».
 */
export default function VegaLogo({ layout = "horizontal", alt = "Vega Sport", className = "", ...props }) {
  const asset = layout === "symbol" ? "symbol" : "logo";
  return (
    <span className={`statarena-logo ${className}`}>
      <img className="logo-dark" src={`/branding/vega/${asset}-dark.svg`} alt={alt} {...props} />
      <img className="logo-light" src={`/branding/vega/${asset}-light.svg`} alt={alt} {...props} />
    </span>
  );
}
