/** Original kit variants, selected by the same theme as the interface. */
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
        src={`/branding/statarena-${layout}-inverse.svg`}
        alt={alt}
        {...props}
      />
      <img
        className="logo-light"
        src={`/branding/statarena-${layout}-color.svg`}
        alt={alt}
        {...props}
      />
    </span>
  );
}
