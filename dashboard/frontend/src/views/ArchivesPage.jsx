"use client";
import BackLink from "../components/BackLink.jsx";
import React from "react";
import Layout from "../components/Layout.jsx";
import Archive from "../components/Archive.jsx";
import ArchiveAttribution from "../components/ArchiveAttribution.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";

export default function ArchivesPage() {
  const f = useFootball();
  return (
    <Layout path="/archives/" title="Archives" hideHeading className="archives-page">
      <BackLink
        className="inline-link competition-back"
        href={f.href("/competitions/")}
        label="Compétitions"
      />
      <Archive />
      <ArchiveAttribution />
    </Layout>
  );
}
