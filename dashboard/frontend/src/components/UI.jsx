import Icon from "./Icon.jsx";
import React, { useEffect, useRef, useState } from "react";
import { number, safeImageUrl, title } from "../services/format.js";
export function Media({ name = "", url, className = "crest" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const src = safeImageUrl(url);
  return (
    <span className={className} aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="image-fallback">
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((x) => x[0])
            .join("")
            .toUpperCase()}
        </span>
      )}
    </span>
  );
}
export function Card({ title, children, action, footer, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-header">
          <h2 className="card-title">{title}</h2>
          {action && <div className="card-actions">{action}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}
export function Empty({ children = "Aucune donnée disponible." }) {
  return <div className="chart-empty">{children}</div>;
}
export function AsyncState({ resource, children }) {
  return resource.loading ? (
    <div role="status" className="loading-state">
      Chargement…
    </div>
  ) : resource.error ? (
    <div role="alert" className="notice notice-warning">
      {resource.error}{" "}
      <button className="button button-secondary" onClick={resource.retry}>
        Réessayer
      </button>
    </div>
  ) : (
    children(resource.value)
  );
}
export function Rating({ value }) {
  return (
    <span
      className={`rating-pill${value >= 8 ? " rating-high" : ""}`}
      title="Note du fournisseur PitchAPI sur10"
    >
      {number(value, 2)}
    </span>
  );
}
export function Segments({ label, value, items, onChange }) {
  return (
    <div className="segmented-control" aria-label={label}>
      {items.map(([id, text]) => (
        <button
          key={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
export function Pager({ page, total, onChange }) {
  return (
    <div className="pagination">
      <button
        className="button button-secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Précédents
      </button>
      <span>
        {page} / {Math.max(1, total)}
      </span>
      <button
        className="button button-secondary"
        disabled={page >= total}
        onClick={() => onChange(page + 1)}
      >
        Suivants
      </button>
    </div>
  );
}
export function Modal({
  title: label,
  onClose,
  children,
  header,
  footer,
  className = "",
}) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.body.style.overflow;
    const opener = document.activeElement;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      queueMicrotask(() => {
        if (opener?.isConnected && typeof opener.focus === "function")
          opener.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={label}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className={`modal-header${header ? " modal-custom-header" : ""}`}>
        {header || <h2>{label}</h2>}
        <button className="modal-close" onClick={onClose} aria-label="Fermer">
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
export function StructuredData({ value, depth = 0 }) {
  if (value == null) return <span className="missing-value">—</span>;
  if (typeof value !== "object")
    return (
      <span>
        {typeof value === "boolean"
          ? value
            ? "Oui"
            : "Non"
          : typeof value === "number"
            ? number(value, 4)
            : String(value)}
      </span>
    );
  if (depth > 6)
    return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value))
    return value.length ? (
      <div className="data-sequence">
        {value.slice(0, 200).map((item, i) => (
          <details className="data-record" key={i} open={value.length < 5}>
            <summary>
              {item?.player?.name ||
                item?.team?.name ||
                item?.name ||
                `Élément ${i + 1}`}
            </summary>
            <StructuredData value={item} depth={depth + 1} />
          </details>
        ))}
        {value.length > 200 && (
          <p>
            {value.length - 200} autres éléments dans le téléchargement JSON
            complet.
          </p>
        )}
      </div>
    ) : (
      <Empty>Aucun élément renseigné.</Empty>
    );
  const simple = Object.entries(value).filter(
      ([, v]) => v === null || typeof v !== "object",
    ),
    nested = Object.entries(value).filter(
      ([, v]) => v !== null && typeof v === "object",
    );
  return (
    <>
      <dl className="data-fields">
        {simple.map(([key, v]) => (
          <div key={key}>
            <dt>{title(key)}</dt>
            <dd>
              {key === "image_url" && safeImageUrl(v) ? (
                <Media name="Image" url={v} />
              ) : (
                <StructuredData value={v} depth={depth + 1} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {nested.map(([key, v]) => (
        <details key={key} className="data-record" open={depth < 1}>
          <summary>{title(key)}</summary>
          <StructuredData value={v} depth={depth + 1} />
        </details>
      ))}
    </>
  );
}
