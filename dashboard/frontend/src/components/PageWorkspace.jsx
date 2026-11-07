"use client";
import React, { useEffect, useRef, useState } from "react";
import { prepareInitialPage } from "../services/initial-page.js";

/** Keep the shared navigation available while the first viewport is prepared. */
export default function PageWorkspace({ className = "", children }) {
  const main = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => prepareInitialPage(main.current, () => setReady(true)), []);
  return (
    <div className="page-presentation">
      {!ready && (
        <div className="page-preparing" role="status">
          Préparation de la page…
        </div>
      )}
      <main
        ref={main}
        id="main"
        className={`workspace ${className}`}
        tabIndex="-1"
        data-page-ready={ready}
        aria-busy={!ready}
        aria-hidden={!ready || undefined}
        inert={!ready}
      >
        {children}
      </main>
    </div>
  );
}
