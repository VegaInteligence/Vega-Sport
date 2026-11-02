/** Official green stadium assets; the interface keeps its production theme. */
export default function StatarenaLogo({
  layout = "horizontal",
  alt = "STATARENA",
  className = "",
  ...props
}) {
  return (
    <span className={`statarena-logo ${className}`}>
      <img
        className="logo-dark"
        src={`/branding/green/logos/svg/statarena-${layout}-dark.svg`}
        alt={alt}
        {...props}
      />
      <img
        className="logo-light"
        src={`/branding/green/logos/svg/statarena-${layout}-light.svg`}
        alt={alt}
        {...props}
      />
    </span>
  );
}
