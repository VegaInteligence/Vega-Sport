/** Vega Intelligence logo. Uses explicit light/dark vectors for the current application theme. */
export default function VegaLogo({ layout = "horizontal", alt = "Vega Intelligence", className = "", ...props }) {
  const asset = layout === "symbol" ? "symbol" : "logo";
  return (
    <span className={`statarena-logo ${className}`}>
      <img className="logo-dark" src={`/branding/vega/${asset}-dark.svg`} alt={alt} {...props} />
      <img className="logo-light" src={`/branding/vega/${asset}-light.svg`} alt={alt} {...props} />
    </span>
  );
}
