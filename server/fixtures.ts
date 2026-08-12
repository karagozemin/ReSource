import type { AppState } from "../src/types";
import { initialEvents, initialMetrics, initialProviders, standingOrder } from "../src/data/demo";

export function createInitialState(executionMode: AppState["executionMode"]): AppState {
  return {
    schemaVersion: 3,
    order: structuredClone(standingOrder),
    providers: structuredClone(initialProviders),
    events: structuredClone(initialEvents),
    metrics: structuredClone(initialMetrics),
    cycles: [],
    selectedProviderId: null,
    mode: "ready",
    executionMode,
    integrationReady: executionMode === "demo",
  };
}
