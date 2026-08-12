import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PendingPayment, Provider } from "../src/types";
import type { ExecutionResult } from "./adapters";

const execFileAsync = promisify(execFile);
const DEFAULT_SLUGS = ["resource-sentinel-risk-provider", "resource-atlas-risk-provider"];
const DEFAULT_CALLDATA = "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240";
const DEFAULT_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

type MarketplaceListing = {
  id: string;
  name: string;
  listedSlug: string;
  priceUsdcPerCall: string;
  inputSchema?: { required?: string[] };
};

type QuotePayload = {
  paymentId: string;
  missingParams: string[];
  candidates: Array<{
    acceptsIndex: number;
    amountHuman: string;
    chainId: string;
    chainName: string;
    tokenSymbol: string;
    recommended: boolean;
  }>;
  decodedChallenge: { recipient: string };
};

export interface MarketplaceClient {
  isReady(): boolean;
  discover(history: Provider[]): Promise<Provider[]>;
  quote(provider: Provider): Promise<PendingPayment>;
  pay(payment: PendingPayment): Promise<ExecutionResult>;
}

export class KeeperHubMarketplaceClient implements MarketplaceClient {
  private readonly apiUrl = process.env.KEEPERHUB_API_URL || "https://app.keeperhub.com/api";
  private readonly apiKey = process.env.KEEPERHUB_API_KEY;
  private readonly buyerAddress = process.env.RESOURCE_BUYER_ADDRESS;
  private readonly slugs = (process.env.KEEPERHUB_MARKETPLACE_SLUGS || DEFAULT_SLUGS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);

  isReady() {
    return Boolean(this.apiKey && this.buyerAddress && this.slugs.length >= 2);
  }

  async discover(history: Provider[]): Promise<Provider[]> {
    const listings = await this.searchRecent();
    const selected = listings.filter((listing) => this.slugs.includes(listing.listedSlug));
    const missing = this.slugs.filter((slug) => !selected.some((listing) => listing.listedSlug === slug));
    for (const slug of missing) {
      const listing = await this.getListing(slug);
      if (listing) selected.push(listing);
    }
    if (selected.length < 2) throw new Error("KeeperHub Marketplace did not return both configured ReSource providers");

    return selected.map((listing) => {
      const previous = history.find((provider) => provider.marketplaceSlug === listing.listedSlug);
      const id = listing.listedSlug.includes("sentinel") ? "sentinel" : listing.listedSlug.includes("atlas") ? "atlas" : listing.id;
      return {
        id,
        name: listing.name.replace(/^ReSource\s+/, "").replace(/\s+Risk Provider$/, ""),
        workflow: listing.listedSlug,
        workflowId: listing.id,
        marketplaceSlug: listing.listedSlug,
        source: "marketplace",
        price: Number(listing.priceUsdcPerCall),
        reliability: previous?.reliability ?? 1,
        latencyMs: previous?.latencyMs ?? 10_000,
        attempts: previous?.attempts ?? 0,
        state: previous?.state ?? "healthy",
      };
    });
  }

  async quote(provider: Provider): Promise<PendingPayment> {
    if (!provider.marketplaceSlug) throw new Error("Provider has no Marketplace slug");
    const payload = await this.runPayment<QuotePayload>([
      "quote", this.callUrl(provider.marketplaceSlug), "--method", "POST", ...this.paramArgs(),
    ]);
    if (payload.missingParams.length) throw new Error(`Marketplace quote is missing: ${payload.missingParams.join(", ")}`);
    const candidate = payload.candidates.find((item) => item.recommended) ?? payload.candidates[0];
    if (!candidate) throw new Error("Marketplace returned no payable candidate");
    return {
      cycleId: "",
      paymentId: payload.paymentId,
      providerId: provider.id,
      acceptsIndex: candidate.acceptsIndex,
      amount: Number(candidate.amountHuman),
      token: candidate.tokenSymbol,
      chainId: candidate.chainId,
      chainName: candidate.chainName,
      recipient: payload.decodedChallenge.recipient,
      createdAt: new Date().toISOString(),
    };
  }

  async pay(payment: PendingPayment): Promise<ExecutionResult> {
    const startedAt = Date.now();
    const payload = await this.runPayment<{
      status: string;
      error: string | null;
      txHash: string | null;
      result?: { executionId?: string; status?: string; output?: unknown; error?: string };
    }>([
      "pay", "--payment-id", payment.paymentId, "--selected-index", String(payment.acceptsIndex), "--yes", ...this.paramArgs(),
    ]);
    const result = payload.result;
    return {
      executionId: result?.executionId ?? payment.paymentId,
      success: payload.status === "success" && result?.status === "success",
      latencyMs: Date.now() - startedAt,
      output: result?.output,
      transactionHash: payload.txHash,
      error: payload.error ?? result?.error ?? (result?.status === "success" ? null : `Marketplace status: ${result?.status ?? payload.status}`),
      paid: payload.status === "success",
      amount: payment.amount,
      paymentProtocol: "x402",
    };
  }

  private async searchRecent(): Promise<MarketplaceListing[]> {
    if (!this.apiKey) throw new Error("KEEPERHUB_API_KEY is required");
    const mcpUrl = this.apiUrl.replace(/\/api\/?$/, "/mcp");
    const init = await fetch(mcpUrl, {
      method: "POST",
      headers: this.mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "resource", version: "0.1.0" } } }),
    });
    if (!init.ok) throw new Error(`KeeperHub MCP initialize failed (${init.status})`);
    const sessionId = init.headers.get("mcp-session-id");
    if (!sessionId) throw new Error("KeeperHub MCP did not return a session id");
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { ...this.mcpHeaders(), "Mcp-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_workflows", arguments: { sort: "recent", workflowType: "read" } } }),
    });
    const body = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `KeeperHub search failed (${response.status})`);
    const text = body.result?.content?.[0]?.text;
    const catalog = text ? JSON.parse(text) as { items?: MarketplaceListing[] } : {};
    return catalog.items ?? [];
  }

  private async getListing(slug: string): Promise<MarketplaceListing | null> {
    const result = await this.callMcpTool<{ id?: string; name?: string; listedSlug?: string; priceUsdcPerCall?: string }>("get_workflow_listing", { slug });
    if (!result.id || !result.name || !result.listedSlug || !result.priceUsdcPerCall) return null;
    return result as MarketplaceListing;
  }

  private async callMcpTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) throw new Error("KEEPERHUB_API_KEY is required");
    const mcpUrl = this.apiUrl.replace(/\/api\/?$/, "/mcp");
    const init = await fetch(mcpUrl, {
      method: "POST",
      headers: this.mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "resource", version: "0.1.0" } } }),
    });
    if (!init.ok) throw new Error(`KeeperHub MCP initialize failed (${init.status})`);
    const sessionId = init.headers.get("mcp-session-id");
    if (!sessionId) throw new Error("KeeperHub MCP did not return a session id");
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { ...this.mcpHeaders(), "Mcp-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `KeeperHub ${name} failed (${response.status})`);
    const text = body.result?.content?.[0]?.text;
    return (text ? JSON.parse(text) : {}) as T;
  }

  private mcpHeaders() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  }

  private callUrl(slug: string) { return `${this.apiUrl}/mcp/workflows/${slug}/call`; }

  private paramArgs() {
    if (!this.buyerAddress) throw new Error("RESOURCE_BUYER_ADDRESS is required");
    return [
      "--param", `calldata=${process.env.RESOURCE_RISK_CALLDATA || DEFAULT_CALLDATA}`,
      "--param", `contractAddress=${process.env.RESOURCE_RISK_CONTRACT || DEFAULT_CONTRACT}`,
      "--param", "value=0",
      "--param", `senderAddress=${this.buyerAddress}`,
    ];
  }

  private async runPayment<T>(args: string[]): Promise<T> {
    const { stdout } = await execFileAsync("onchainos", ["payment", ...args], { maxBuffer: 1024 * 1024 });
    const envelope = JSON.parse(stdout) as { ok: boolean; data?: T; error?: string };
    if (!envelope.ok || !envelope.data) throw new Error(envelope.error ?? "Agent payment command failed");
    return envelope.data;
  }
}
