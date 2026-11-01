"use client";
import React from "react";
import Layout from "../components/Layout.jsx";
import UpcomingMatches from "../components/UpcomingMatches.jsx";

export default function CalendarPage() {
  return (
    <Layout
      path="/calendrier/"
      title="Calendrier"
      filters
      filterKind="fixtures"
    >
      <UpcomingMatches />
    </Layout>
  );
}
