import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
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
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { initialEvents, initialMetrics, initialProviders, standingOrder as initialOrder } from "./data/demo";
import { rankProviders } from "./lib/procurement";
import type { AppState } from "./types";

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
  const [providers, setProviders] = useState(initialProviders);
  const [events, setEvents] = useState(initialEvents);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [order, setOrder] = useState(initialOrder);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"ready" | "running" | "healthy" | "recovering">("ready");
  const [executionMode, setExecutionMode] = useState<"demo" | "keeperhub">("demo");
  const [integrationReady, setIntegrationReady] = useState(true);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<AppState>("/api/state").then(applyState).catch((error) => setRequestError(error.message));
  }, []);

  const decisions = useMemo(
    () => rankProviders(providers, order, metrics.spend),
    [providers, order, metrics.spend],
  );

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;
  const isPaused = order.status === "paused";
  const busy = pending || mode === "running" || mode === "recovering";

  function applyState(state: AppState) {
    setProviders(state.providers);
    setEvents(state.events);
    setMetrics(state.metrics);
    setOrder(state.order);
    setSelectedId(state.selectedProviderId);
    setMode(state.mode);
    setExecutionMode(state.executionMode);
    setIntegrationReady(state.integrationReady);
    setRequestError(null);
  }

  async function runCycle() {
    if (busy || isPaused) return;
    setPending(true);
    setMode("running");
    try {
      const response = await apiRequest<{ state: AppState }>(`/api/standing-orders/${order.id}/run`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      applyState(response.state);
    } catch (error) {
      setMode("ready");
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  }

  async function injectFailure() {
    if (busy || !selectedId || executionMode !== "demo") return;
    setPending(true);
    setMode("recovering");
    try {
      const response = await apiRequest<{ state: AppState }>("/api/demo/failure", { method: "POST" });
      applyState(response.state);
    } catch (error) {
      setMode("ready");
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  }

  async function resetDemo() {
    if (executionMode !== "demo") return;
    setPending(true);
    try { applyState(await apiRequest<AppState>("/api/demo/reset", { method: "POST" })); }
    catch (error) { setRequestError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function togglePause() {
    if (busy) return;
    setPending(true);
    try { applyState(await apiRequest<AppState>("/api/standing-orders/toggle", { method: "POST" })); }
    catch (error) { setRequestError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="ReSource">
          <div className="brand-icon"><RefreshCw size={18} strokeWidth={2.4} /></div>
          <span>ReSource</span>
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          <button className="nav-item active" title="Overview"><LayoutDashboard size={18} /><span>Overview</span></button>
          <button className="nav-item" title="Standing orders"><History size={18} /><span>Orders</span><span className="nav-count">1</span></button>
          <button className="nav-item" title="Providers"><Bot size={18} /><span>Providers</span><span className="nav-count">3</span></button>
          <button className="nav-item" title="Executions"><Zap size={18} /><span>Executions</span></button>
          <button className="nav-item" title="Settings"><Settings2 size={18} /><span>Settings</span></button>
        </nav>
        <div className="sidebar-foot">
          <div className="network-line"><span className={`status-dot ${integrationReady ? "" : "offline"}`} /> {executionMode === "demo" ? "Demo adapter" : "KeeperHub adapter"}</div>
          <div className="network-meta">{executionMode === "demo" ? "No funds at risk" : integrationReady ? "Credentials loaded" : "Configuration required"}</div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <div className="eyebrow">Autonomous procurement</div>
            <h1>Operations overview</h1>
          </div>
          <div className="top-actions">
            {executionMode === "demo" && <button className="icon-button" onClick={resetDemo} title="Reset demo" aria-label="Reset demo"><RotateCcw size={17} /></button>}
            <div className="adapter-pill"><span className={`status-dot ${integrationReady ? "" : "offline"}`} /> {executionMode === "demo" ? "Demo mode" : "KeeperHub"} <ChevronDown size={14} /></div>
          </div>
        </header>

        <section className="health-band" aria-label="System status">
          <div className="health-copy">
            <div className={`pulse-icon ${mode}`}><HeartPulse size={22} /></div>
            <div>
              <div className="health-title">
                {mode === "recovering" ? "Automatic recovery in progress" : mode === "running" ? "Procurement cycle running" : isPaused ? "Standing order paused" : selected ? "Service requirement satisfied" : "Ready to procure"}
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
          <Metric icon={<HeartPulse />} label="Recoveries" value={metrics.recoveries.toString()} note="automatic failovers" accent />
          <Metric icon={<CircleDollarSign />} label="Spend" value={money.format(metrics.spend)} note={`of ${money.format(order.dailyBudget)} daily`} />
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
              <div className="eyebrow">Demo control</div>
              <h2 id="action-title">Prove the recovery loop</h2>
              <p>Run a policy-driven purchase, then degrade the selected provider and watch ReSource recover.</p>
            </div>
            <div className="demo-steps">
              <Step number="01" label="Run procurement" done={metrics.cycles > 0} />
              <Step number="02" label="Inject timeout" done={providers.find((provider) => provider.id === "sentinel")?.state === "ineligible"} />
              <Step number="03" label="Verify recovery" done={metrics.recoveries > 0} />
            </div>
            <div className="action-buttons">
              {selectedId === "sentinel" && executionMode === "demo" ? (
                <button className="danger-button" onClick={injectFailure} disabled={busy}><TriangleAlert size={17} />Inject provider failure</button>
              ) : (
                <button className="primary-button" onClick={runCycle} disabled={busy || isPaused}><Play size={17} />{busy ? "Cycle running" : selectedId === "atlas" ? "Run another cycle" : "Run procurement cycle"}</button>
              )}
              {executionMode === "demo" && <button className="icon-button in-panel" onClick={resetDemo} title="Reset demo" aria-label="Reset demo"><RotateCcw size={17} /></button>}
            </div>
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
                      <td><div className="provider-cell"><span className={`provider-logo logo-${decision.provider.id}`}>{decision.provider.name.charAt(0)}</span><span><strong>{decision.provider.name}</strong><small>{decision.provider.workflow}</small></span></div></td>
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

        <footer>
          <span><WalletCards size={15} /> Execution adapter: <strong>{executionMode}</strong></span>
          <button className="text-button">Integration notes <ExternalLink size={14} /></button>
        </footer>
      </main>
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

export default App;

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  return payload as T;
}
