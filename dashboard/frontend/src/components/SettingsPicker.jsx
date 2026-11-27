"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// `bare`: the trigger joins a track its parent draws (the competition page's bar, § 80) instead of its own.
export default function SettingsPicker({ pane, icon, label, text, disabled, triggerClassName, controlId, value, className = "", bare = false, children }) {
  const id = useId();
  const trigger = useRef(null);
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;
    const box = dialog.current;
    const button = trigger.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.showModal();
    const position = () => {
      const anchor = button.getBoundingClientRect();
      const { width, height } = box.getBoundingClientRect();
      box.style.setProperty("--picker-left", `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`);
      box.style.setProperty("--picker-top", `${Math.max(12, Math.min(anchor.bottom + 10, window.innerHeight - height - 12))}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(box);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      box.close();
      document.body.style.overflow = overflow;
      button.focus({ preventScroll: true });
    };
  }, [open]);

  const button = (
    <button
      type="button"
      ref={trigger}
      id={controlId}
      data-value={value}
      className={triggerClassName || "home-settings-segment"}
      aria-label={triggerClassName ? label : `${label} : ${text}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      disabled={disabled}
      onClick={() => setOpen(true)}
    >
      {!triggerClassName && <Icon name={icon} />}
      <span>{text}</span>
      {!triggerClassName && <Icon name="chevron" className="home-settings-chevron" />}
    </button>
  );

  return (
    <div className={`settings-picker ${className}`.trim()}>
      {triggerClassName || bare ? button : <div className="home-settings">{button}</div>}
      {open && (
        <dialog
          id={id}
          ref={dialog}
          className="home-settings-panel settings-picker-panel"
          data-pane={pane}
          aria-label={label}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
              close();
          }}
        >
          <div className="home-settings-pane">{children(close)}</div>
        </dialog>
      )}
    </div>
  );
}
