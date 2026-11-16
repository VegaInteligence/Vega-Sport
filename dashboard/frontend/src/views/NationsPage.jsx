"use client";
/** /nations/: the national teams ranked by their Vega Elo; /nations/?id=: one nation's page. */
import React from "react";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { NationIndex, NationProfile } from "../components/NationPages.jsx";

export default function NationsPage() {
  const params = useSearchParams();
  const id = params?.get("id") || "";
  return (
    <Layout path="/nations/" title="Nations" hideHeading={Boolean(id)} performanceComparison={false}>
      {id ? <NationProfile key={id} id={id} /> : <NationIndex />}
    </Layout>
  );
}
