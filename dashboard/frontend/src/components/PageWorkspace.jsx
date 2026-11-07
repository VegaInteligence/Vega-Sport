"use client";
import React, { useEffect, useRef, useState } from "react";
import { prepareInitialPage } from "../services/initial-page.js";
import PageLoader from "./PageLoader.jsx";
import { useResourceBootstrap } from "../services/resource-bootstrap.js";

/** Keep the shared navigation available while the first viewport is prepared. */
export default function PageWorkspace({ className = "", children }) {
  const main = useRef(null);
  const [ready, setReady] = useState(false);
  const bootstrap = useResourceBootstrap();
  const serverHome = Boolean(
    bootstrap?.homeReady && className.includes("home-page"),
  );
  useEffect(() => prepareInitialPage(main.current, () => setReady(true)), []);
  return (
    <div className="page-presentation">
      {(!ready || serverHome) && (
        <div className={serverHome ? "server-home-loader" : undefined}>
          <PageLoader overlay />
        </div>
      )}
      <main
        ref={main}
        id="main"
        className={`workspace ${className}`}
        tabIndex="-1"
        data-page-ready={ready}
        data-server-home={serverHome || undefined}
        aria-busy={!ready}
        aria-hidden={(!ready && !serverHome) || undefined}
        inert={!ready && !serverHome}
      >
        {children}
      </main>
    </div>
  );
}
