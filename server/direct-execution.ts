import { randomUUID } from "node:crypto";
import type { DirectProof } from "../src/types";

export class KeeperHubDirectExecutionClient {
  private readonly apiUrl = process.env.KEEPERHUB_API_URL || "https://app.keeperhub.com/api";
  private readonly apiKey = process.env.KEEPERHUB_API_KEY;
  private readonly chainId = "84532";

  isReady() { return Boolean(this.apiKey); }

  async simulate(): Promise<DirectProof> {
    const address = await this.walletAddress();
    const result = await this.request<Record<string, unknown>>("/execute/transfer", {
      method: "POST",
      body: JSON.stringify({ chainId: Number(this.chainId), recipientAddress: address, amount: "0", simulate: true }),
    });
    return {
      status: "simulated",
      chainId: this.chainId,
      network: "Base Sepolia",
      from: String(result.from),
      to: String(result.to),
      gasEstimate: String(result.gasEstimate),
      executionId: null,
      transactionHash: null,
      transactionLink: null,
      error: null,
    };
  }

  async broadcast(): Promise<DirectProof> {
    const simulation = await this.simulate();
    const result = await this.request<{ executionId: string; status: string }>("/execute/transfer", {
      method: "POST",
      headers: { "Idempotency-Key": `resource-proof-${randomUUID()}` },
      body: JSON.stringify({ chainId: Number(this.chainId), recipientAddress: simulation.to, amount: "0" }),
    });
    return this.wait(result.executionId, simulation);
  }

  private async wait(executionId: string, simulation: DirectProof): Promise<DirectProof> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${this.apiUrl}/execute/${executionId}/status`, { headers: this.headers() });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(`KeeperHub direct status failed (${response.status})`);
      const status = String(result.status);
      if (status === "completed" || status === "failed") {
        return {
          ...simulation,
          status: status === "completed" ? "completed" : "failed",
          executionId,
          transactionHash: typeof result.transactionHash === "string" ? result.transactionHash : null,
          transactionLink: typeof result.transactionLink === "string" ? result.transactionLink : null,
          error: typeof result.error === "string" ? result.error : null,
        };
      }
      const seconds = Number(response.headers.get("x-poll-interval-hint") || 2);
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, seconds * 1000)));
    }
    throw new Error("KeeperHub direct execution did not reach a terminal state");
  }

  private async walletAddress() {
    const wallet = await this.request<{ walletAddress: string }>("/user/wallet", { method: "GET" });
    return wallet.walletAddress;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`KeeperHub ${response.status}: ${JSON.stringify(payload)}`);
    return payload as T;
  }

  private headers() {
    if (!this.apiKey) throw new Error("KEEPERHUB_API_KEY is required");
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }
}
