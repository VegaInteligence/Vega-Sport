import Icon from "./Icon.jsx";
import ApiImage from "./ApiImage.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  number,
  safeImageUrl,
  mediaImageSource,
  title,
} from "../services/format.js";
export function Media({ name = "", url, fallbackUrl, className = "crest" }) {
  // Source changes remount the attempt state, including a deferred first reveal.
  return (
    <MediaSource
      key={`${url || ""}\n${fallbackUrl || ""}`}
      name={name}
      url={url}
      fallbackUrl={fallbackUrl}
      className={className}
    />
  );
}
function MediaSource({ name, url, fallbackUrl, className }) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const element = useRef(null);
  useEffect(() => {
    const node = element.current;
    const defer = () => setDeferred(true);
    node.addEventListener("vega:defer-image", defer);
    return () => node.removeEventListener("vega:defer-image", defer);
  }, []);
  const src = deferred
    ? null
    : mediaImageSource(url, fallbackUrl, failed, fallbackFailed);
  return (
    <span
      ref={element}
      className={className}
      aria-hidden="true"
      data-page-media=""
      data-media-state={
        !src ? "fallback" : loaded === src ? "ready" : "loading"
      }
    >
      {src ? (
        <ApiImage
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          onError={() => {
            // Native image events do not expose status or Retry-After. Keep the
            // existing single alternate source; never retry a failed source.
            if (!failed && src === safeImageUrl(url)) setFailed(true);
            else setFallbackFailed(true);
          }}
        />
      ) : (
        <span className="image-fallback">
          {(typeof name === "string" ? name : "")
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
export function AsyncState({ resource, children, loading }) {
  return resource.loading ? (
    <div data-page-loading="">
      {loading || (
        <div role="status" className="loading-state">
          Chargement…
        </div>
      )}
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
      title="Note sur 10"
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
export function Pager({ page, total, onChange, label = "Pagination" }) {
  if (total <= 1) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="button button-secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Précédents
      </button>
      <span
        aria-label={`Page ${page} sur ${Math.max(1, total)}`}
        aria-live="polite"
      >
        {page} / {Math.max(1, total)}
      </span>
      <button
        className="button button-secondary"
        disabled={page >= total}
        onClick={() => onChange(page + 1)}
      >
        Suivants
      </button>
    </nav>
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
function DataRecord({ label, open: initiallyOpen, lazy, children }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className="data-record"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{label}</summary>
      {(!lazy || open) && children}
    </details>
  );
}
function DataSequence({ value, depth, lazy }) {
  const [page, setPage] = useState(1);
  const size = 50,
    total = Math.ceil(value.length / size),
    current = Math.min(page, total),
    start = (current - 1) * size;
  return (
    <div className="data-sequence">
      <div className="data-sequence-count" role="status">
        {number(start + 1)}–{number(Math.min(start + size, value.length))} /{" "}
        {number(value.length)}
      </div>
      {value.slice(start, start + size).map((item, offset) => (
        <DataRecord
          key={start + offset}
          open={value.length < 5}
          lazy={lazy}
          label={
            <>
              <span className="data-record-index">{start + offset + 1}.</span>{" "}
              {item?.player?.name ||
                item?.team?.name ||
                item?.name ||
                `Élément ${start + offset + 1}`}
            </>
          }
        >
          <StructuredData value={item} depth={depth + 1} lazy={lazy} />
        </DataRecord>
      ))}
      {total > 1 && <Pager page={current} total={total} onChange={setPage} />}
    </div>
  );
}
export function StructuredData({ value, depth = 0, lazy = false }) {
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
      <DataSequence value={value} depth={depth} lazy={lazy} />
    ) : (
      <Empty>Aucun élément renseigné.</Empty>
    );
  const simple = Object.entries(value).filter(
      ([, v]) => v === null || typeof v !== "object",
    ),
    nested = Object.entries(value).filter(
      ([, v]) => v !== null && typeof v === "object",
    );
  if (!simple.length && !nested.length) return <code>{"{}"}</code>;
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
                <StructuredData value={v} depth={depth + 1} lazy={lazy} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {nested.map(([key, v]) => (
        <DataRecord key={key} open={depth < 1} label={title(key)} lazy={lazy}>
          <StructuredData value={v} depth={depth + 1} lazy={lazy} />
        </DataRecord>
      ))}
    </>
  );
}
