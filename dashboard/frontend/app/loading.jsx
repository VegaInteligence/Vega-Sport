"use client";
import LoadingPage from "../src/components/LoadingPage.jsx";
import { useFootball } from "../src/hooks/FootballContext.jsx";

const plainHref = (page) => page;
export default function Loading() {
  const f = useFootball();
  return <LoadingPage href={f?.href || plainHref} />;
}
