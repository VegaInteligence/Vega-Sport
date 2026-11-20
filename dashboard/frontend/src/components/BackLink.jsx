"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { goBack, previousPage } from "../services/back-navigation.js";

/**
 * A « ← » button: back to the page the visitor came from in this tab, named
 * after it. With no earlier page of the site (direct entry, new tab), it keeps
 * its fixed destination: `href`, or `onFallback` for an in-page action. The
 * server render and modified clicks (new tab, new window) always use `href`.
 */
export default function BackLink({
  href,
  onFallback,
  label,
  prefix = "← ",
  className,
  ...rest
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [previous, setPrevious] = useState(null);
  useEffect(() => {
    const update = () => setPrevious(previousPage());
    update();
    // The router writes history from an insertion effect: read it once that commit is over.
    let timer;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 0);
    };
    const navigation = window.navigation;
    navigation?.addEventListener?.("currententrychange", later);
    return () => {
      clearTimeout(timer);
      navigation?.removeEventListener?.("currententrychange", later);
    };
  }, [pathname, search]);
  const onClick = (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (previous) {
      event.preventDefault();
      goBack(previous.steps);
    } else if (onFallback) {
      event.preventDefault();
      onFallback();
    }
  };
  const content = (
    <>
      {prefix}
      {previous?.label || label}
    </>
  );
  if (!href)
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        data-back={previous ? "history" : "fixed"}
        {...rest}
      >
        {content}
      </button>
    );
  return (
    <Link
      href={href}
      className={className}
      onClick={onClick}
      data-back={previous ? "history" : "fixed"}
      {...rest}
    >
      {content}
    </Link>
  );
}
