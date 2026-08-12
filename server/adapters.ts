import { randomUUID } from "node:crypto";
import type { Provider, StandingOrder } from "../src/types";

export type ExecutionResult = {
  executionId: string;
  success: boolean;
  latencyMs: number;
  output: unknown;
  transactionHash: string | null;
  error: string | null;
};

export interface ExecutionAdapter {
  readonly mode: "demo" | "keeperhub";
  isReady(): boolean;
  execute(provider: Provider, order: StandingOrder): Promise<ExecutionResult>;
}

export class DemoExecutionAdapter implements ExecutionAdapter {
  readonly mode = "demo" as const;
  isReady() { return true; }

  async execute(provider: Provider): Promise<ExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, 280));
    return {
      executionId: `demo_${randomUUID()}`,
      success: true,
      latencyMs: provider.latencyMs,
      output: { riskLevel: "low", verified: true, source: provider.id },
      transactionHash: null,
      error: null,
    };
  }
}

type KeeperHubEnvelope<T> = T | { data: T };

export class KeeperHubExecutionAdapter implements ExecutionAdapter {
  readonly mode = "keeperhub" as const;
  private readonly baseUrl = process.env.KEEPERHUB_API_URL || "https://app.keeperhub.com/api";
  private readonly apiKey = process.env.KEEPERHUB_API_KEY;
  private readonly workflowIds: Record<string, string | undefined> = {
    atlas: process.env.KEEPERHUB_WORKFLOW_ATLAS,
    sentinel: process.env.KEEPERHUB_WORKFLOW_SENTINEL,
    veridian: process.env.KEEPERHUB_WORKFLOW_VERIDIAN,
  };

  isReady() {
    return Boolean(this.apiKey && Object.values(this.workflowIds).some(Boolean));
  }

  async execute(provider: Provider, order: StandingOrder): Promise<ExecutionResult> {
    if (!this.apiKey) throw new Error("KEEPERHUB_API_KEY is required in keeperhub mode");
    const workflowId = this.workflowIds[provider.id];
    if (!workflowId) throw new Error(`No KeeperHub workflow configured for ${provider.name}`);
    const startedAt = Date.now();
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "x-request-id": `resource-${randomUUID()}`,
    };
    const executionResponse = await fetch(`${this.baseUrl}/workflows/${workflowId}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: { service: order.service, standingOrderId: order.id } }),
    });
    const executionPayload = await parseResponse<KeeperHubEnvelope<{ executionId: string; status: string }>>(executionResponse);
    const execution = "data" in executionPayload ? executionPayload.data : executionPayload;
    const receiptResponse = await fetch(`${this.baseUrl}/workflows/executions/${execution.executionId}/wait?timeoutMs=60000`, { headers });
    const receiptPayload = await parseResponse<KeeperHubEnvelope<{
      status: string;
      output?: unknown;
      error?: string | null;
      transactionHashes?: Array<{ hash: string }>;
    }>>(receiptResponse);
    const receipt = "data" in receiptPayload ? receiptPayload.data : receiptPayload;

    return {
      executionId: execution.executionId,
      success: receipt.status === "success",
      latencyMs: Date.now() - startedAt,
      output: receipt.output,
      transactionHash: receipt.transactionHashes?.[0]?.hash ?? null,
      error: receipt.error ?? (receipt.status === "success" ? null : `KeeperHub status: ${receipt.status}`),
    };
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : response.statusText;
    throw new Error(`KeeperHub ${response.status}: ${detail}`);
  }
  return payload as T;
}
