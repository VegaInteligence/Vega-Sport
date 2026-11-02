"use client";
import Link from "next/link";
import React from "react";
import Layout from "../components/Layout.jsx";
import Archive from "../components/Archive.jsx";
import ArchiveAttribution from "../components/ArchiveAttribution.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";

export default function ArchivesPage() {
  const f = useFootball();
  return (
    <Layout path="/archives/" title="Archives">
      <Link
        className="inline-link competition-back"
        href={f.href("/competitions/")}
      >
        ← Retour aux compétitions
      </Link>
      <Archive />
      <ArchiveAttribution />
    </Layout>
  );
}
