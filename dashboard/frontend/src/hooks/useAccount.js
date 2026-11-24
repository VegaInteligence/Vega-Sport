"use client";
// The signed-in state (services/account-state.js) in a component. The server and the first client render see the
// same "unknown" (or "off") state, so hydration never mismatches; the session is read after it.
import { useSyncExternalStore } from "react";
import {
  getAccountState,
  getServerAccountState,
  subscribeAccount,
} from "../services/account-state.js";

export function useAccount() {
  return useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
}
