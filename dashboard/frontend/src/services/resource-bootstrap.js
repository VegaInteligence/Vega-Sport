"use client";
import { createContext, useContext } from "react";

// Values come from this request's server component, never a server-global cache.
export const ResourceBootstrapContext = createContext(null);
export const useResourceBootstrap = () => useContext(ResourceBootstrapContext);
