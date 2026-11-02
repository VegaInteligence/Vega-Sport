"use client";
import LoadingPage from "../src/components/LoadingPage.jsx";

const plainHref = (page) => page;
/** Server-rendered app shell shown until the client takes over. */
export default function ShellFallback() {
  return <LoadingPage href={plainHref} />;
}
