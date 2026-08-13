import { useMemo, useState } from "react";
import { Activity, Bot, CheckCircle2, CircleDollarSign, Clock3, ExternalLink, Gauge, Pause, Play, RefreshCw, Save, ShieldCheck } from "lucide-react";
import type { DirectProof, ProcurementCycle, Provider, ProviderDecision, RuntimeInfo, StandingOrder, StandingOrderUpdate } from "./types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function OrdersView({ order, busy, paymentPending, readOnly, onSave, onToggle }: {
  order: StandingOrder;
  busy: boolean;
  paymentPending: boolean;
  readOnly: boolean;
  onSave: (update: StandingOrderUpdate) => Promise<boolean>;
  onToggle: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<StandingOrderUpdate>(() => toUpdate(order));
  const [dirty, setDirty] = useState(false);

  function numberField(field: keyof StandingOrderUpdate, value: string) {
    setDraft((current) => ({ ...current, [field]: Number(value) }));
    setDirty(true);
  }

  return (
    <div className="workspace-grid orders-workspace">
      <section className="workspace-panel policy-panel">
        <div className="section-heading compact">
          <div><div className="eyebrow">{order.id}</div><h2>Procurement policy</h2></div>
          <span className={`state-badge ${order.status === "paused" ? "paused" : "active"}`}><span />{order.status}</span>
        </div>
        <div className="form-grid">
          <label className="field"><span>Interval</span><div className="input-with-unit"><input disabled={readOnly} type="number" min="1" max="1440" step="1" value={draft.intervalMinutes} onChange={(event) => numberField("intervalMinutes", event.target.value)} /><small>minutes</small></div></label>
          <label className="field"><span>Max price</span><div className="input-with-unit"><input disabled={readOnly} type="number" min="0.01" max="100" step="0.01" value={draft.maxPrice} onChange={(event) => numberField("maxPrice", event.target.value)} /><small>USDC</small></div></label>
          <label className="field"><span>Daily budget</span><div className="input-with-unit"><input disabled={readOnly} type="number" min={draft.maxPrice} max="10000" step="0.01" value={draft.dailyBudget} onChange={(event) => numberField("dailyBudget", event.target.value)} /><small>USDC</small></div></label>
          <label className="field"><span>Max latency</span><div className="input-with-unit"><input disabled={readOnly} type="number" min="1000" max="300000" step="1000" value={draft.maxLatencyMs} onChange={(event) => numberField("maxLatencyMs", event.target.value)} /><small>ms</small></div></label>
          <label className="field"><span>Minimum reliability</span><div className="input-with-unit"><input disabled={readOnly} type="number" min="0" max="100" step="0.1" value={Number((draft.minReliability * 100).toFixed(2))} onChange={(event) => numberField("minReliability", String(Number(event.target.value) / 100))} /><small>%</small></div></label>
          <label className="toggle-field"><span><strong>Automatic failover</strong><small>Re-procure after an SLA breach</small></span><input disabled={readOnly} type="checkbox" checked={draft.automaticFailover} onChange={(event) => { setDraft((current) => ({ ...current, automaticFailover: event.target.checked })); setDirty(true); }} /></label>
        </div>
        {!readOnly && <div className="panel-actions">
          <button className="secondary-button" onClick={() => void onToggle()} disabled={busy}>{order.status === "active" ? <Pause size={15} /> : <Play size={15} />}{order.status === "active" ? "Pause order" : "Resume order"}</button>
          <button className="primary-button fit" onClick={() => void onSave(draft).then((saved) => { if (saved) setDirty(false); })} disabled={busy || !dirty || paymentPending}><Save size={15} />Save policy</button>
        </div>}
        {paymentPending && <div className="inline-notice warning">Policy editing is locked while a payment authorization is pending.</div>}
      </section>

      <section className="workspace-panel order-summary">
        <div className="section-heading compact"><div><div className="eyebrow">Service requirement</div><h2>{order.service}</h2></div></div>
        <p>{order.description}</p>
        <div className="summary-list">
          <SummaryRow icon={<Clock3 />} label="Cadence" value={`Every ${order.intervalMinutes} min`} />
          <SummaryRow icon={<CircleDollarSign />} label="Budget ceiling" value={`${money.format(order.dailyBudget)} / day`} />
          <SummaryRow icon={<Gauge />} label="Latency SLA" value={`${(order.maxLatencyMs / 1000).toFixed(0)} sec`} />
          <SummaryRow icon={<ShieldCheck />} label="Reliability floor" value={`${(order.minReliability * 100).toFixed(1)}%`} />
        </div>
      </section>
    </div>
  );
}

export function ProvidersView({ decisions, selectedId, busy, readOnly, onRefresh, onRequalify }: {
  decisions: ProviderDecision[];
  selectedId: string | null;
  busy: boolean;
  readOnly: boolean;
  onRefresh: () => Promise<void>;
  onRequalify: (id: string) => Promise<void>;
}) {
  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading compact">
        <div><div className="eyebrow">Marketplace inventory</div><h2>{decisions.length} discovered providers</h2></div>
        {!readOnly && <button className="secondary-button" onClick={() => void onRefresh()} disabled={busy}><RefreshCw size={15} className={busy ? "spin-soft" : ""} />Refresh catalog</button>}
      </div>
      <div className="provider-directory">
        {decisions.map((decision, index) => {
          const provider = decision.provider;
          return (
            <article className={`provider-record ${selectedId === provider.id ? "selected" : ""}`} key={provider.id}>
              <div className="provider-identity"><span className={`provider-logo logo-${provider.id}`}>{provider.name.charAt(0)}</span><span><strong>{provider.name}</strong><small>{provider.marketplaceSlug ?? provider.workflow}</small></span></div>
              <div className="provider-stat"><span>Price</span><strong>{provider.price.toFixed(2)} USDC</strong></div>
              <div className="provider-stat"><span>Reliability</span><strong>{(provider.reliability * 100).toFixed(1)}%</strong></div>
              <div className="provider-stat"><span>Latency</span><strong>{(provider.latencyMs / 1000).toFixed(1)}s</strong></div>
              <div className="provider-stat"><span>Runs</span><strong>{provider.attempts}</strong></div>
              <div className="provider-decision">{selectedId === provider.id ? <span className="decision selected"><CheckCircle2 size={13} />Selected</span> : decision.eligible ? <span className="decision eligible">#{index + 1} eligible</span> : <span className="decision rejected">{decision.reason}</span>}</div>
              <div className="provider-control">{!readOnly && !decision.eligible && <button className="secondary-button" onClick={() => void onRequalify(provider.id)} disabled={busy}>Requalify</button>}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type CycleFilter = "all" | "paid" | "failed";

export function ExecutionsView({ cycles, providers, directProof }: { cycles: ProcurementCycle[]; providers: Provider[]; directProof: DirectProof }) {
  const [filter, setFilter] = useState<CycleFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(cycles[0]?.id ?? null);
  const filtered = useMemo(() => cycles.filter((cycle) => filter === "all" || (filter === "paid" ? cycle.paymentProtocol === "x402" : ["failed", "policy_blocked", "no_provider"].includes(cycle.status))), [cycles, filter]);
  const selected = cycles.find((cycle) => cycle.id === selectedId) ?? filtered[0] ?? null;
  const providerName = (id: string | null) => providers.find((provider) => provider.id === id)?.name ?? id ?? "None";

  return (
    <div className="executions-layout">
      <section className="workspace-panel execution-list">
        <div className="section-heading compact">
          <div><div className="eyebrow">Immutable audit history</div><h2>{cycles.length} procurement cycles</h2></div>
          <div className="segmented" aria-label="Execution filter">{(["all", "paid", "failed"] as CycleFilter[]).map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
        </div>
        <div className="execution-rows">
          {filtered.length === 0 && <div className="empty-state"><Activity size={22} />No executions in this filter.</div>}
          {filtered.map((cycle) => <button className={`execution-row ${selected?.id === cycle.id ? "selected" : ""}`} key={cycle.id} onClick={() => setSelectedId(cycle.id)}><span className={`cycle-status ${cycle.status}`} /><span><strong>{providerName(cycle.selectedProviderId)}</strong><small>{dateTime.format(new Date(cycle.startedAt))}</small></span><span className={`status-label ${cycle.status}`}>{cycle.status.replace("_", " ")}</span><span className="cycle-amount">{cycle.amount ? `${cycle.amount.toFixed(2)} USDC` : "No charge"}</span></button>)}
        </div>
      </section>
      <aside className="workspace-panel execution-detail">
        <div className="section-heading compact"><div><div className="eyebrow">Selected execution</div><h2>{selected ? providerName(selected.selectedProviderId) : "No execution"}</h2></div></div>
        {selected ? <dl className="detail-list">
          <Detail label="Status" value={selected.status.replace("_", " ")} />
          <Detail label="Cycle" value={shortId(selected.id)} />
          <Detail label="Protocol" value={selected.paymentProtocol ?? "Workflow execution"} />
          <Detail label="Amount" value={selected.amount ? `${selected.amount.toFixed(2)} USDC` : "0 USDC"} />
          <Detail label="Execution" value={selected.executionId ? shortId(selected.executionId) : "Not recorded"} />
          {selected.transactionHash && <div><dt>Transaction</dt><dd><a href={`https://basescan.org/tx/${selected.transactionHash}`} target="_blank" rel="noreferrer">{shortId(selected.transactionHash)} <ExternalLink size={12} /></a></dd></div>}
          {selected.error && <div className="detail-error"><dt>Error</dt><dd>{selected.error}</dd></div>}
        </dl> : <div className="empty-state">No cycle selected.</div>}
        <div className="proof-summary"><span>Direct proof · {directProof.network}</span><strong>{directProof.status}</strong>{directProof.transactionLink && <a href={directProof.transactionLink} target="_blank" rel="noreferrer">View proof <ExternalLink size={12} /></a>}</div>
      </aside>
    </div>
  );
}

export function SettingsView({ runtime, executionMode, integrationReady, busy, sponsoredDemo, onSchedulerChange, onRefresh }: {
  runtime: RuntimeInfo;
  executionMode: "demo" | "keeperhub";
  integrationReady: boolean;
  busy: boolean;
  sponsoredDemo: boolean;
  onSchedulerChange: (enabled: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="workspace-grid settings-workspace">
      <section className="workspace-panel settings-panel">
        <div className="section-heading compact"><div><div className="eyebrow">Runtime</div><h2>Automation</h2></div></div>
        <div className="setting-row"><span><strong>Scheduler</strong><small>{runtime.scheduler.pollMs ? `Poll every ${(runtime.scheduler.pollMs / 1000).toFixed(0)} seconds` : "Runtime control unavailable"}</small></span><input type="checkbox" checked={runtime.scheduler.enabled} disabled={busy || sponsoredDemo || runtime.scheduler.pollMs === null} onChange={(event) => void onSchedulerChange(event.target.checked)} /></div>
        {sponsoredDemo && <div className="setting-row"><span><strong>Sponsored live demo</strong><small>Public purchases draw from the runtime wallet after explicit confirmation</small></span><span className="locked-value">Wallet funded</span></div>}
        <div className="setting-row"><span><strong>Automatic fail-closed policy</strong><small>Blocks empty, invalid or over-budget execution</small></span><span className="locked-value">Enforced</span></div>
      </section>
      <section className="workspace-panel settings-panel">
        <div className="section-heading compact"><div><div className="eyebrow">Integration</div><h2>Execution adapter</h2></div><button className="icon-button" onClick={() => void onRefresh()} disabled={busy} title="Refresh health" aria-label="Refresh health"><RefreshCw size={16} /></button></div>
        <div className="integration-state"><span className={`integration-icon ${integrationReady ? "ready" : "offline"}`}><Bot size={20} /></span><span><strong>{executionMode === "keeperhub" ? "KeeperHub" : "Demo adapter"}</strong><small>{integrationReady ? "Connected and ready" : "Configuration required"}</small></span><span className={`state-badge ${integrationReady ? "active" : "paused"}`}><span />{integrationReady ? "Healthy" : "Offline"}</span></div>
        <dl className="detail-list compact-list"><Detail label="Procurement protocol" value={executionMode === "keeperhub" ? "x402 / USDC" : "Simulated"} /><Detail label="Settlement network" value={executionMode === "keeperhub" ? "Base" : "None"} /><Detail label="Direct proof network" value={executionMode === "keeperhub" ? "Base Sepolia" : "None"} /></dl>
      </section>
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div><span>{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function toUpdate(order: StandingOrder): StandingOrderUpdate { return { intervalMinutes: order.intervalMinutes, maxPrice: order.maxPrice, dailyBudget: order.dailyBudget, maxLatencyMs: order.maxLatencyMs, minReliability: order.minReliability, automaticFailover: order.automaticFailover }; }
function shortId(value: string) { return value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-7)}` : value; }
