import path from "node:path";
import { fileURLToPath } from "node:url";
import { DemoExecutionAdapter, KeeperHubExecutionAdapter } from "./adapters";
import { buildApp } from "./app";
import { KeeperHubDirectExecutionClient } from "./direct-execution";
import { KeeperHubMarketplaceClient } from "./marketplace";
import { ProcurementOrchestrator } from "./orchestrator";
import { TriggerEngine } from "./scheduler";
import { JsonStateStore } from "./store";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.env.EXECUTION_MODE === "keeperhub" ? "keeperhub" : "demo";
const adapter = mode === "keeperhub" ? new KeeperHubExecutionAdapter() : new DemoExecutionAdapter();
const marketplace = mode === "keeperhub" ? new KeeperHubMarketplaceClient() : undefined;
const directExecution = mode === "keeperhub" ? new KeeperHubDirectExecutionClient() : undefined;
const orchestrator = new ProcurementOrchestrator(new JsonStateStore(path.join(root, "data/runtime.json")), adapter, marketplace, directExecution);
await orchestrator.initialize();

const scheduler = new TriggerEngine(orchestrator, Number(process.env.SCHEDULER_POLL_MS || 30_000));
if (process.env.SCHEDULER_ENABLED === "true") scheduler.start();

const app = buildApp(orchestrator);
app.addHook("onClose", async () => scheduler.stop());
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 8787) });
