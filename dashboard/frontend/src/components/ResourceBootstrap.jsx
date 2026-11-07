"use client";
import React, { useLayoutEffect } from "react";
import { ResourceBootstrapContext } from "../services/resource-bootstrap.js";
import { browserHomeBootstrapMatches } from "../services/home-bootstrap-preferences.js";

export default function ResourceBootstrap({ bootstrap, children }) {
  useLayoutEffect(() => {
    if (!bootstrap?.homeReady) return;
    if (
      !browserHomeBootstrapMatches(
        bootstrap.state,
        bootstrap.resources.manifest,
      )
    )
      document.documentElement.dataset.homeBootstrapMismatch = "true";
    else delete document.documentElement.dataset.homeBootstrapMismatch;
  }, [bootstrap]);
  return (
    <ResourceBootstrapContext.Provider value={bootstrap || null}>
      {children}
    </ResourceBootstrapContext.Provider>
  );
}
