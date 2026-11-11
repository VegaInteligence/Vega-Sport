"use client";
import React from "react";
import dynamic from "next/dynamic";

// Every page's payload carries the 404 tree: the game's code and styles are
// fetched only where that tree is displayed.
const NotFoundGame = dynamic(() => import("./NotFoundGame.jsx"));
export default function NotFoundGameLoader() {
  return <NotFoundGame />;
}
