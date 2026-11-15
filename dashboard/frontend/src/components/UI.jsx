import Icon from "./Icon.jsx";
import { useCardFold } from "./PhoneFold.jsx";
import ApiImage from "./ApiImage.jsx";
import DirectMediaImage from "./DirectMediaImage.jsx";
import { useResolvedMedia } from "./MediaContext.jsx";
import mediaStyles from "./Media.module.css";
import React, { useEffect, useRef, useState } from "react";
import { GRADE_HIGH } from "../services/grades.js";
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
  const [directFailed, setDirectFailed] = useState(false);
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
  const source = failed ? fallbackUrl : url;
  const direct = useResolvedMedia(source);
  const legacy = mediaImageSource(url, fallbackUrl, failed, fallbackFailed);
  const src = deferred
    ? null
    : !directFailed && direct && legacy
      ? direct
      : legacy;
  return (
    <span
      ref={element}
      className={`${className} ${mediaStyles.media}`}
      aria-hidden="true"
      data-page-media=""
      data-media-state={
        !src ? "fallback" : loaded === src ? "ready" : "loading"
      }
    >
      {loaded !== src || !src ? (
        <span className={`image-fallback ${mediaStyles.fallback}`}>
          {(typeof name === "string" ? name : "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((x) => x[0])
            .join("")
            .toUpperCase() || "\u2014"}
        </span>
      ) : null}
      {src ? (
        <MediaImage
          direct={src === direct}
          dimension={
            /season-player-portrait|pc-portrait/.test(className)
              ? 192
              : /home-avatar-xl/.test(className)
                ? 96
                : 64
          }
          className={
            loaded === src ? mediaStyles.imageReady : mediaStyles.imagePending
          }
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          onError={() => {
            if (src === direct) setDirectFailed(true);
            else if (!failed && src === safeImageUrl(url)) {
              setFailed(true);
              setDirectFailed(false);
            } else setFallbackFailed(true);
          }}
        />
      ) : null}
    </span>
  );
}
function MediaImage({ direct, dimension, ...props }) {
  return direct ? (
    <DirectMediaImage key={props.src} {...props} dimension={dimension} />
  ) : (
    <ApiImage {...props} />
  );
}
/** `fold`: on a phone the card shows closed, its heading alone (PhoneFold). */
export function Card({
  title,
  children,
  action,
  footer,
  className = "",
  fold = false,
}) {
  const f = useCardFold(fold && Boolean(title), title);
  return (
    <section className={`card ${className}`} {...f.section}>
      {title && (
        <div className="card-header" {...f.head}>
          <h2 className="card-title">{title}</h2>
          {action && (
            <div className={`card-actions ${f.part}`.trim()}>{action}</div>
          )}
          {f.button}
        </div>
      )}
      <div className={`card-body ${f.part}`.trim()}>{children}</div>
      {footer && <div className={`card-footer ${f.part}`.trim()}>{footer}</div>}
    </section>
  );
}
export function Empty({ children = "Aucune donnée disponible." }) {
  return <div className="chart-empty">{children}</div>;
}
const SKELETON_WIDTHS = ["92%", "76%", "84%", "62%", "88%", "70%"];
/**
 * The shape of what is loading: grey lines in place of the content, its label read by
 * screen readers only. `kind`: "block" (lines of text), "table" (full rows) or "inline" (a
 * short line inside a sentence). Extra props (data-page-loading…) go to the outer element.
 */
export function Skeleton({ label = "Chargement…", lines = 3, kind = "block", className = "", ...rest }) {
  if (kind === "inline")
    return (
      <span className={`skeleton-inline ${className}`.trim()} role="status" {...rest}>
        <span className="sr-only">{label}</span>
        <span className="skeleton-line" aria-hidden="true" />
      </span>
    );
  return (
    <div className={`skeleton skeleton-${kind} ${className}`.trim()} role="status" aria-busy="true" {...rest}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skeleton-line"
          aria-hidden="true"
          style={kind === "table" ? undefined : { width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
export function AsyncState({ resource, children, loading }) {
  return resource.loading ? (
    <div data-page-loading="">{loading || <Skeleton />}</div>
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
/** Vega's grade of a match or a season, out of 100 (50 an ordinary match of the role). */
export function Grade({ value, title = "Note Vega sur 100" }) {
  return (
    <span className={`rating-pill${value >= GRADE_HIGH ? " rating-high" : ""}`} title={title}>
      {number(value, 0)}
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
