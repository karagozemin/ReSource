import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Gauge,
  HeartPulse,
  History,
  LayoutDashboard,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { initialEvents, initialMetrics, initialProviders, standingOrder as initialOrder } from "./data/demo";
import { rankProviders } from "./lib/procurement";
import type { AppState, DirectProof, PendingPayment, RuntimeInfo, StandingOrderUpdate } from "./types";
import type { ProcurementCycle } from "./types";
import { ExecutionsView, OrdersView, ProvidersView, SettingsView } from "./WorkspaceViews";

type ViewId = "overview" | "orders" | "providers" | "executions" | "settings";

const viewTitles: Record<ViewId, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "Autonomous procurement", title: "Operations overview" },
  orders: { eyebrow: "Standing order management", title: "Orders" },
  providers: { eyebrow: "Service marketplace", title: "Providers" },
  executions: { eyebrow: "Procurement audit", title: "Executions" },
  settings: { eyebrow: "Buyer runtime", title: "Settings" },
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const eventTime = (value: string) => {
  if (!value.includes("T")) return value;
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
};

function App() {
  const [experience, setExperience] = useState<"landing" | "entering" | "app">(() => Object.hasOwn(viewTitles, window.location.hash.slice(1)) ? "app" : "landing");
  const [activeView, setActiveView] = useState<ViewId>(readInitialView);
  const [providers, setProviders] = useState(initialProviders);
  const [events, setEvents] = useState(initialEvents);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [order, setOrder] = useState(initialOrder);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<AppState["mode"]>("ready");
  const [executionMode, setExecutionMode] = useState<"demo" | "keeperhub">("demo");
  const [integrationReady, setIntegrationReady] = useState(true);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [directProof, setDirectProof] = useState<DirectProof>({ status: "ready", chainId: "84532", network: "Base Sepolia", from: null, to: null, gasEstimate: null, executionId: null, transactionHash: null, transactionLink: null, error: null });
  const [cycles, setCycles] = useState<ProcurementCycle[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo>({ scheduler: { enabled: false, pollMs: null }, sponsoredDemo: { enabled: false, spendCap: null, remaining: null } });
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operatorDialogOpen, setOperatorDialogOpen] = useState(false);
  const [operatorKeyInput, setOperatorKeyInput] = useState("");
  const [operatorUnlocked, setOperatorUnlocked] = useState(() => Boolean(sessionStorage.getItem("resource-operator-key")));

  useEffect(() => {
    void Promise.all([apiRequest<AppState>("/api/state"), apiRequest<RuntimeInfo>("/api/runtime")])
      .then(([state, runtimeInfo]) => { applyState(state); setRuntime(runtimeInfo); })
      .catch((error) => setRequestError(error.message));
  }, []);

  useEffect(() => {
    const showOperatorDialog = () => { setOperatorUnlocked(Boolean(sessionStorage.getItem("resource-operator-key"))); setOperatorDialogOpen(true); };
    window.addEventListener("resource-auth-required", showOperatorDialog);
    return () => window.removeEventListener("resource-auth-required", showOperatorDialog);
  }, []);

  const decisions = useMemo(
    () => rankProviders(providers, order, metrics.spend),
    [providers, order, metrics.spend],
  );

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;
  const isPaused = order.status === "paused";
  const busy = pending || mode === "running" || mode === "recovering";
  const sponsoredDemo = executionMode === "keeperhub" && runtime.sponsoredDemo?.enabled === true;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function enterWorkspace() {
    setExperience("entering");
    window.setTimeout(() => setExperience("app"), 1450);
  }

  function beginOperation(label: string) {
    setOperation(label);
    setNotice(null);
  }

  function failOperation(error: unknown) {
    setOperation(null);
    setRequestError(error instanceof Error ? error.message : String(error));
  }

  function completeOperation(label: string) {
    setNotice(label);
    setOperation(null);
  }

  function applyState(state: AppState) {
    setProviders(state.providers);
    setEvents(state.events);
    setMetrics(state.metrics);
    setOrder(state.order);
    setSelectedId(state.selectedProviderId);
    setMode(state.mode);
    setExecutionMode(state.executionMode);
    setIntegrationReady(state.integrationReady);
    setPendingPayment(state.pendingPayment);
    setDirectProof(state.directProof);
    setCycles(state.cycles);
    setRequestError(null);
  }

  async function runCycle() {
    if (busy || isPaused) return;
    setPending(true);
    setMode("running");
    beginOperation("Evaluating provider market");
    try {
      const response = await apiRequest<{ state: AppState }>(`/api/standing-orders/${order.id}/run`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      applyState(response.state);
      completeOperation(response.state.pendingPayment ? "Quote ready for authorization" : "Procurement cycle verified");
    } catch (error) {
      setMode("ready");
      failOperation(error);
    } finally { setPending(false); }
  }

  async function injectFailure() {
    if (busy || !selectedId) return;
    setPending(true);
    setMode("recovering");
    beginOperation("Detecting breach and rerouting service");
    try {
      const response = await apiRequest<{ state: AppState }>(executionMode === "demo" ? "/api/demo/failure" : "/api/providers/selected/failure", { method: "POST" });
      applyState(response.state);
      completeOperation("Provider replaced automatically");
    } catch (error) {
      setMode("ready");
      failOperation(error);
    } finally { setPending(false); }
  }

  async function confirmPayment() {
    if (!pendingPayment || busy) return;
    setPending(true);
    setMode("running");
    beginOperation("Authorizing and verifying payment");
    try {
      const response = await apiRequest<{ state: AppState; needsReconfirmation?: boolean }>(`/api/procurement/${pendingPayment.cycleId}/confirm-payment`, {
        method: "POST",
        headers: { "x-resource-payment-confirmation": pendingPayment.cycleId },
      });
      applyState(response.state);
      completeOperation("Payment settled and result verified");
      if (response.needsReconfirmation) setRequestError("Payment quote expired and was refreshed. Review the new terms, then authorize again.");
    } catch (error) {
      setMode("awaiting_payment");
      failOperation(error);
    } finally { setPending(false); }
  }

  async function runDirectProof(action: "simulate" | "broadcast") {
    if (busy) return;
    setPending(true);
    beginOperation(action === "simulate" ? "Simulating onchain proof" : "Broadcasting onchain proof");
    try { applyState(await apiRequest<AppState>(`/api/direct-proof/${action}`, { method: "POST" })); completeOperation(action === "simulate" ? "Simulation passed" : "Transaction confirmed"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function resetDemo() {
    if (executionMode !== "demo") return;
    setPending(true);
    beginOperation("Resetting demo environment");
    try { applyState(await apiRequest<AppState>("/api/demo/reset", { method: "POST" })); completeOperation("Demo environment reset"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function togglePause() {
    if (busy) return;
    setPending(true);
    beginOperation(isPaused ? "Resuming standing order" : "Pausing standing order");
    try { applyState(await apiRequest<AppState>("/api/standing-orders/toggle", { method: "POST" })); completeOperation(isPaused ? "Standing order resumed" : "Standing order paused"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function saveOrder(update: StandingOrderUpdate) {
    if (busy) return false;
    setPending(true);
    beginOperation("Validating procurement policy");
    try {
      applyState(await apiRequest<AppState>("/api/standing-orders/policy", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }));
      completeOperation("Procurement policy saved");
      return true;
    }
    catch (error) { failOperation(error); return false; }
    finally { setPending(false); }
  }

  async function refreshProviders() {
    if (busy) return;
    setPending(true);
    beginOperation("Refreshing marketplace catalog");
    try { applyState(await apiRequest<AppState>("/api/providers/refresh", { method: "POST" })); completeOperation("Provider catalog refreshed"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function requalifyProvider(providerId: string) {
    if (busy) return;
    setPending(true);
    beginOperation("Requalifying provider");
    try { applyState(await apiRequest<AppState>(`/api/providers/${providerId}/requalify`, { method: "POST" })); completeOperation("Provider requalified"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function setScheduler(enabled: boolean) {
    setPending(true);
    beginOperation(enabled ? "Enabling scheduler" : "Disabling scheduler");
    try { setRuntime(await apiRequest<RuntimeInfo>("/api/runtime/scheduler", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) })); completeOperation(enabled ? "Scheduler enabled" : "Scheduler disabled"); }
    catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  async function refreshHealth() {
    setPending(true);
    beginOperation("Checking runtime health");
    try {
      const [state, runtimeInfo] = await Promise.all([apiRequest<AppState>("/api/state"), apiRequest<RuntimeInfo>("/api/runtime")]);
      applyState(state);
      setRuntime(runtimeInfo);
      completeOperation("Runtime health refreshed");
    } catch (error) { failOperation(error); }
    finally { setPending(false); }
  }

  function navigate(view: ViewId) {
    setActiveView(view);
    window.history.replaceState(null, "", view === "overview" ? window.location.pathname : `#${view}`);
  }

  function saveOperatorKey() {
    const value = operatorKeyInput.trim();
    if (!value) return;
    sessionStorage.setItem("resource-operator-key", value);
    setOperatorUnlocked(true);
    setOperatorKeyInput("");
    setOperatorDialogOpen(false);
    setNotice("Operator session unlocked");
    setRequestError(null);
  }

  function lockOperatorSession() {
    sessionStorage.removeItem("resource-operator-key");
    setOperatorUnlocked(false);
    setOperatorDialogOpen(false);
    setNotice("Operator session locked");
  }

  if (experience !== "app") return <Landing entering={experience === "entering"} onEnter={enterWorkspace} />;

  return (
    <div className="app-shell">
      {(operation || notice) && <div className={`operation-toast ${operation ? "working" : "success"}`} role="status"><span className="toast-icon">{operation ? <RefreshCw size={17} /> : <Check size={17} />}</span><span><strong>{operation ?? notice}</strong><small>{operation ? "ReSource is executing this operation" : "Operation completed successfully"}</small></span>{operation && <span className="toast-progress" />}</div>}
      {operatorDialogOpen && <div className="operator-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOperatorDialogOpen(false); }}><form className="operator-dialog" onSubmit={(event) => { event.preventDefault(); saveOperatorKey(); }}><div className="operator-dialog-icon"><LockKeyhole size={20} /></div><div><div className="eyebrow">Protected runtime</div><h2>Unlock operator controls</h2><p>Enter the Render operator key for this browser session.</p></div><label><span>Operator key</span><input autoFocus type="password" autoComplete="off" value={operatorKeyInput} onChange={(event) => setOperatorKeyInput(event.target.value)} /></label><div className="operator-dialog-actions">{operatorUnlocked && <button type="button" className="secondary-button" onClick={lockOperatorSession}>Lock session</button>}<button type="button" className="secondary-button" onClick={() => setOperatorDialogOpen(false)}>Cancel</button><button type="submit" className="primary-button fit" disabled={!operatorKeyInput.trim()}>Unlock</button></div></form></div>}
      <aside className="sidebar">
        <div className="brand-mark" aria-label="ReSource">
          <div className="brand-icon"><img src="/brand/resource-mark-192.png" alt="" /></div>
          <span>ReSource<small>Autonomous buyer</small></span>
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          <button className={`nav-item ${activeView === "overview" ? "active" : ""}`} onClick={() => navigate("overview")} title="Overview"><LayoutDashboard size={18} /><span>Overview</span></button>
          <button className={`nav-item ${activeView === "orders" ? "active" : ""}`} onClick={() => navigate("orders")} title="Standing orders"><History size={18} /><span>Orders</span><span className="nav-count">1</span></button>
          <button className={`nav-item ${activeView === "providers" ? "active" : ""}`} onClick={() => navigate("providers")} title="Providers"><Bot size={18} /><span>Providers</span><span className="nav-count">{providers.length}</span></button>
          <button className={`nav-item ${activeView === "executions" ? "active" : ""}`} onClick={() => navigate("executions")} title="Executions"><Zap size={18} /><span>Executions</span><span className="nav-count">{cycles.length}</span></button>
          <button className={`nav-item ${activeView === "settings" ? "active" : ""}`} onClick={() => navigate("settings")} title="Settings"><Settings2 size={18} /><span>Settings</span></button>
        </nav>
        <div className="sidebar-foot">
          <div className="network-line"><span className={`status-dot ${integrationReady ? "" : "offline"}`} /> {executionMode === "demo" ? "Demo adapter" : "KeeperHub adapter"}</div>
          <div className="network-meta">{executionMode === "demo" ? "No funds at risk" : integrationReady ? "Credentials loaded" : "Configuration required"}</div>
          <button className="back-to-site" onClick={() => setExperience("landing")}><ArrowRight size={13} /> Back to site</button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <div className="eyebrow">{viewTitles[activeView].eyebrow}</div>
            <h1>{viewTitles[activeView].title}</h1>
          </div>
          <div className="top-actions">
            <div className="live-clock"><span /> Live operations</div>
            {sponsoredDemo
              ? <div className="operator-button unlocked sponsored-status"><Sparkles size={14} />Sponsored live</div>
              : <button className={`operator-button ${operatorUnlocked ? "unlocked" : ""}`} onClick={() => setOperatorDialogOpen(true)}><LockKeyhole size={14} />{operatorUnlocked ? "Operator" : "Unlock"}</button>}
            {executionMode === "demo" && <button className="icon-button" onClick={resetDemo} title="Reset demo" aria-label="Reset demo"><RotateCcw size={17} /></button>}
            <div className="adapter-pill"><span className={`status-dot ${integrationReady ? "" : "offline"}`} /> {executionMode === "demo" ? "Demo mode" : "KeeperHub"} <ChevronDown size={14} /></div>
          </div>
        </header>

        {requestError && activeView !== "overview" && <div className="page-error request-error" role="alert">{requestError}<button onClick={() => setRequestError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}

        {activeView === "overview" && <>
        <section className="health-band" aria-label="System status">
          <div className="health-copy">
            <div className={`pulse-icon ${mode}`}><HeartPulse size={22} /></div>
            <div>
              <div className="health-title">
                {mode === "recovering" ? "Automatic recovery in progress" : mode === "awaiting_payment" ? "Payment authorization required" : mode === "running" ? "Procurement cycle running" : isPaused ? "Standing order paused" : selected ? "Service requirement satisfied" : "Ready to procure"}
              </div>
              <div className="health-detail">
                {selected ? `${selected.name} currently supplies transaction risk intelligence.` : "One active Standing Order is waiting for execution."}
              </div>
            </div>
          </div>
          <div className="health-route" aria-label="Procurement lifecycle">
            <span>Need</span><ArrowRight size={14} /><span>Evaluate</span><ArrowRight size={14} /><span>Buy</span><ArrowRight size={14} /><span>Verify</span><ArrowRight size={14} /><span>Heal</span>
          </div>
        </section>

        <section className="metrics-grid" aria-label="Key metrics">
          <Metric icon={<RefreshCw />} label="Cycles" value={metrics.cycles.toString()} note="procurement runs" />
          <Metric icon={<Bot />} label="Evaluations" value={metrics.evaluations.toString()} note="provider decisions" />
          <Metric icon={<CheckCircle2 />} label="Purchases" value={metrics.purchases.toString()} note="verified results" />
          <Metric icon={<TriangleAlert />} label="Failures" value={cycles.filter((cycle) => ["failed", "policy_blocked", "no_provider"].includes(cycle.status)).length.toString()} note="failed closed" />
          <Metric icon={<HeartPulse />} label="Recoveries" value={metrics.recoveries.toString()} note="automatic failovers" accent />
          <Metric icon={<Zap />} label="Executions" value={metrics.executions.toString()} note="verified workflows" />
          <Metric icon={<CircleDollarSign />} label="Spend" value={money.format(metrics.spend)} note={`${money.format(metrics.savings)} saved vs highest`} />
        </section>

        <div className="content-grid">
          <section className="order-panel" aria-labelledby="order-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Standing order · {order.id}</div>
                <h2 id="order-title">{order.service}</h2>
              </div>
              <span className={`state-badge ${isPaused ? "paused" : "active"}`}><span />{isPaused ? "Paused" : "Active"}</span>
            </div>
            <p className="order-description">{order.description}</p>
            <div className="constraint-grid">
              <Constraint icon={<Clock3 />} label="Frequency" value={`Every ${order.intervalMinutes} min`} />
              <Constraint icon={<CircleDollarSign />} label="Max price" value={`${money.format(order.maxPrice)} / run`} />
              <Constraint icon={<Gauge />} label="Max latency" value={`${order.maxLatencyMs / 1000} seconds`} />
              <Constraint icon={<ShieldCheck />} label="Reliability" value={`≥ ${order.minReliability * 100}%`} />
            </div>
            <div className="order-foot">
              <div className="failover-copy"><Sparkles size={16} /><span><strong>Self-healing enabled</strong><small>Replace providers when policy is breached</small></span></div>
              <button className="secondary-button" onClick={togglePause} disabled={busy}>
                {isPaused ? <Play size={16} /> : <Pause size={16} />}{isPaused ? "Resume" : "Pause"}
              </button>
            </div>
          </section>

          <section className="action-panel" aria-labelledby="action-title">
            <div>
              <div className="eyebrow">{executionMode === "demo" ? "Demo control" : "Live buyer"}</div>
              <h2 id="action-title">{executionMode === "demo" ? "Prove the recovery loop" : "Marketplace procurement"}</h2>
              <p>{executionMode === "demo" ? "Run a policy-driven purchase, then degrade the selected provider and watch ReSource recover." : "Discover competing KeeperHub services, enforce policy, authorize x402, and verify the paid result."}</p>
            </div>
            <div className="demo-steps">
              <Step number="01" label={executionMode === "demo" ? "Run procurement" : "Discover and select"} done={metrics.cycles > 0} />
              <Step number="02" label={executionMode === "demo" ? "Inject timeout" : "Authorize x402 payment"} done={executionMode === "demo" ? providers.find((provider) => provider.id === "sentinel")?.state === "ineligible" : metrics.purchases > 0} />
              <Step number="03" label={executionMode === "demo" ? "Verify recovery" : "Verify provider result"} done={executionMode === "demo" ? metrics.recoveries > 0 : cycles.some((cycle) => cycle.status === "completed" && cycle.paymentProtocol === "x402")} />
            </div>
            {pendingPayment && (
              <div className="payment-authorization">
                <div><span>{sponsoredDemo ? "Sponsored payment confirmation" : "Payment authorization"}</span><strong>{pendingPayment.amount.toFixed(2)} {pendingPayment.token}</strong></div>
                <dl>
                  <div><dt>Network</dt><dd>{pendingPayment.chainName} ({pendingPayment.chainId})</dd></div>
                  <div><dt>Provider</dt><dd>{providers.find((provider) => provider.id === pendingPayment.providerId)?.name ?? pendingPayment.providerId}</dd></div>
                  <div><dt>Protocol</dt><dd><strong>OKX Agent Payments Protocol</strong></dd></div>
                  <div><dt>Atomic amount</dt><dd>{Math.round(pendingPayment.amount * 1_000_000)} units</dd></div>
                  <div><dt>Pay to</dt><dd>{pendingPayment.recipient}</dd></div>
                </dl>
                {sponsoredDemo && <small>ReSource sponsors this live purchase. No wallet connection or operator key is required.</small>}
              </div>
            )}
            <div className="action-buttons">
              {pendingPayment ? (
                <>
                  <button className="primary-button" onClick={confirmPayment} disabled={busy}><WalletCards size={17} />{busy ? "Payment running" : `Authorize ${pendingPayment.amount.toFixed(2)} ${pendingPayment.token}`}</button>
                  {executionMode === "keeperhub" && !sponsoredDemo && <button className="icon-button in-panel" onClick={injectFailure} disabled={busy} title="Simulate provider SLA breach" aria-label="Simulate provider SLA breach"><TriangleAlert size={17} /></button>}
                </>
              ) : selectedId === "sentinel" && executionMode === "demo" ? (
                <button className="danger-button" onClick={injectFailure} disabled={busy}><TriangleAlert size={17} />Inject provider failure</button>
              ) : (
                <button className="primary-button" onClick={runCycle} disabled={busy || isPaused}><Play size={17} />{busy ? "Cycle running" : selectedId === "atlas" ? "Run another cycle" : "Run procurement cycle"}</button>
              )}
              {executionMode === "demo" && <button className="icon-button in-panel" onClick={resetDemo} title="Reset demo" aria-label="Reset demo"><RotateCcw size={17} /></button>}
            </div>
            {executionMode === "keeperhub" && (
              <div className="direct-proof">
                <div><span>Direct onchain proof</span><strong>{directProof.network}</strong></div>
                <small>{directProof.status === "ready" ? "Safe first-write sequence is ready." : directProof.status === "simulated" ? `Simulation passed · ${directProof.gasEstimate} gas` : directProof.status === "completed" ? "KeeperHub transaction confirmed" : directProof.error ?? "Direct proof failed"}</small>
                {directProof.transactionLink
                  ? <a href={directProof.transactionLink} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} /></a>
                  : sponsoredDemo
                    ? <span className="locked-value">Operator only</span>
                    : <button className="secondary-button" onClick={() => runDirectProof(directProof.status === "simulated" ? "broadcast" : "simulate")} disabled={busy}>{directProof.status === "simulated" ? <Zap size={15} /> : <ShieldCheck size={15} />}{directProof.status === "simulated" ? "Broadcast proof" : "Simulate proof"}</button>}
              </div>
            )}
            {requestError && <div className="request-error" role="alert">{requestError}</div>}
          </section>
        </div>

        <div className="lower-grid">
          <section className="providers-section" aria-labelledby="providers-title">
            <div className="section-heading compact">
              <div><div className="eyebrow">Live market</div><h2 id="providers-title">Provider ranking</h2></div>
              <div className="weight-legend"><span>Price 40%</span><span>Reliability 40%</span><span>Latency 20%</span></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Provider</th><th>Price</th><th>Reliability</th><th>Avg latency</th><th>Score</th><th>Decision</th></tr></thead>
                <tbody>
                  {decisions.map((decision, index) => (
                    <tr key={decision.provider.id} className={selectedId === decision.provider.id ? "selected-row" : ""}>
                      <td><div className="provider-cell"><span className={`provider-logo logo-${decision.provider.id}`}>{decision.provider.name.charAt(0)}</span><span><strong>{decision.provider.name}</strong><small>{decision.provider.marketplaceSlug ?? decision.provider.workflow}</small></span></div></td>
                      <td>{money.format(decision.provider.price)}</td>
                      <td><span className={decision.provider.reliability < order.minReliability ? "negative" : ""}>{(decision.provider.reliability * 100).toFixed(decision.provider.reliability * 100 % 1 ? 1 : 0)}%</span></td>
                      <td><span className={decision.provider.latencyMs > order.maxLatencyMs ? "negative" : ""}>{(decision.provider.latencyMs / 1000).toFixed(1)}s</span></td>
                      <td>{decision.score ? <span className="score"><span style={{ width: `${decision.score * 100}%` }} />{(decision.score * 100).toFixed(1)}</span> : <span className="muted">—</span>}</td>
                      <td>{selectedId === decision.provider.id ? <span className="decision selected"><Check size={13} />Selected</span> : decision.eligible ? <span className="decision eligible">#{index + 1} Eligible</span> : <span className="decision rejected"><X size={13} />{decision.reason}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="timeline-section" aria-labelledby="timeline-title">
            <div className="section-heading compact">
              <div><div className="eyebrow">Audit trail</div><h2 id="timeline-title">Live timeline</h2></div>
              {busy && <Activity size={18} className="spin-soft" />}
            </div>
            <div className="timeline" aria-live="polite">
              {events.map((event) => (
                <div className="timeline-event" key={event.id}>
                  <span className={`event-mark ${event.kind}`} />
                  <div><div className="event-line"><strong>{event.title}</strong><time>{eventTime(event.time)}</time></div><p>{event.detail}</p></div>
                </div>
              ))}
            </div>
          </section>
        </div>
        </>}

        {activeView === "orders" && <OrdersView order={order} busy={busy} paymentPending={pendingPayment !== null} readOnly={sponsoredDemo} onSave={saveOrder} onToggle={togglePause} />}
        {activeView === "providers" && <ProvidersView decisions={decisions} selectedId={selectedId} busy={busy} readOnly={sponsoredDemo} onRefresh={refreshProviders} onRequalify={requalifyProvider} />}
        {activeView === "executions" && <ExecutionsView cycles={cycles} providers={providers} directProof={directProof} />}
        {activeView === "settings" && <SettingsView runtime={runtime} executionMode={executionMode} integrationReady={integrationReady} busy={busy} sponsoredDemo={sponsoredDemo} onSchedulerChange={setScheduler} onRefresh={refreshHealth} />}

        <footer>
          <span><WalletCards size={15} /> Execution adapter: <strong>{executionMode}</strong></span>
          <button className="text-button" onClick={() => navigate("settings")}>Integration settings <ExternalLink size={14} /></button>
        </footer>
      </main>
    </div>
  );
}

function Landing({ entering, onEnter }: { entering: boolean; onEnter: () => void }) {
  return (
    <div className={`landing ${entering ? "is-entering" : ""}`}>
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="ReSource home"><span><img src="/brand/resource-mark-192.png" alt="" /></span>ReSource</a>
        <nav aria-label="Landing navigation"><a href="#system">System</a><a href="#proof">Proof</a></nav>
        <button className="nav-launch" onClick={onEnter}>Open console <ArrowUpRight size={15} /></button>
      </header>

      <main id="top" className="landing-main">
        <section className="landing-hero">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-copy">
            <div className="hero-kicker"><span /> Autonomous procurement infrastructure</div>
            <h1>ReSource</h1>
            <p className="hero-statement">Services fail.<br /><em>Your agent doesn’t.</em></p>
            <p className="hero-description">A self-healing buyer that discovers, evaluates, pays, verifies, and replaces agent services before a broken provider becomes your problem.</p>
            <div className="hero-actions">
              <button className="hero-primary" onClick={onEnter}>Enter live workspace <ArrowRight size={18} /></button>
              <a href="#system">Explore the system <ArrowUpRight size={16} /></a>
            </div>
          </div>

          <div className="network-stage" aria-label="Live provider network visualization">
            <div className="network-label top"><span>STANDING ORDER</span><strong>Transaction risk</strong></div>
            <div className="network-core"><span className="core-ring" /><img className="core-mark" src="/brand/resource-mark-192.png" alt="" /></div>
            <div className="route route-a"><i /><i /><i /></div>
            <div className="route route-b"><i /><i /></div>
            <div className="route route-c failed"><i /><i /></div>
            <div className="provider-node node-a"><span>A</span><div><strong>Atlas Risk</strong><small>99.0% reliable</small></div><b>ACTIVE</b></div>
            <div className="provider-node node-b"><span>S</span><div><strong>Sentinel Labs</strong><small>13.1s latency</small></div></div>
            <div className="provider-node node-c"><span>V</span><div><strong>Veridian</strong><small>SLA rejected</small></div></div>
            <div className="recovery-chip"><CheckCircle2 size={15} /><span><strong>Route recovered</strong><small>186ms ago</small></span></div>
            <div className="network-stats"><span><small>UPTIME</small><strong>99.98%</strong></span><span><small>RECOVERIES</small><strong>24</strong></span><span><small>AVG SWITCH</small><strong>1.8s</strong></span></div>
          </div>
          <div className="hero-scroll"><span>01</span><i /><small>THE SYSTEM</small></div>
        </section>

        <section className="system-section" id="system">
          <div className="section-index">01 / 03</div>
          <div className="system-heading"><p>Built for agents that cannot stop.</p><h2>One standing order.<br />Continuous resilience.</h2></div>
          <div className="system-flow" id="proof">
            <article><span>01</span><Terminal /><h3>Define the need</h3><p>Set price, reliability, latency, and budget constraints once.</p></article>
            <article><span>02</span><Bot /><h3>Source the market</h3><p>Continuously score competing providers against observed performance.</p></article>
            <article><span>03</span><ShieldCheck /><h3>Verify every result</h3><p>Release payment only when output and service policy both pass.</p></article>
            <article className="accent"><span>04</span><RefreshCw /><h3>Heal automatically</h3><p>Detect degradation, suspend the provider, and reroute the order.</p></article>
          </div>
        </section>
      </main>

      {entering && <div className="intro-overlay" aria-live="polite"><div className="intro-mark"><img src="/brand/resource-mark-512.png" alt="" /></div><div className="intro-copy"><strong>Initializing buyer runtime</strong><span><i />Policy engine</span><span><i />Provider market</span><span><i />Verification layer</span></div><div className="intro-line" /></div>}
    </div>
  );
}

function Metric({ icon, label, value, note, accent = false }: { icon: React.ReactNode; label: string; value: string; note: string; accent?: boolean }) {
  return <div className={`metric ${accent ? "accent" : ""}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}

function Constraint({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="constraint"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function Step({ number, label, done }: { number: string; label: string; done: boolean }) {
  return <div className={`demo-step ${done ? "done" : ""}`}><span>{done ? <Check size={13} /> : number}</span>{label}</div>;
}

function readInitialView(): ViewId {
  const candidate = window.location.hash.slice(1);
  return Object.hasOwn(viewTitles, candidate) ? candidate as ViewId : "overview";
}

export default App;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    const operatorKey = sessionStorage.getItem("resource-operator-key");
    if (operatorKey) headers.set("x-resource-operator-key", operatorKey);
  }
  const response = await fetch(`${apiBaseUrl}${url}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    sessionStorage.removeItem("resource-operator-key");
    window.dispatchEvent(new Event("resource-auth-required"));
  }
  if (!response.ok) throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  return payload as T;
}
