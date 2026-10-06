import { existsSync } from "node:fs";
import path from "node:path";
import { address, createClient, nonDivisibleSequentialInstructionPlan } from "@solana/kit";
import { tokenProgram } from "@solana-program/token";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signerFromFile } from "@solana/kit-plugin-signer";
import type { Provider, StandingOrder } from "../src/types";
import type { BreachReceipt, ExecutionAdapter, ExecutionContext, ExecutionResult } from "./adapters";
import {
  getCreateProcurementInstruction,
  getMarkBreachedInstruction,
  getReplaceProviderInstruction,
  RESOURCE_REGISTRY_PROGRAM_ID,
} from "./solana-registry";

export type SolanaCluster = "devnet" | "mainnet-beta";

export type SolanaSettlementReceipt = {
  signature: string;
  explorerUrl: string;
  amount: number;
  token: string;
  recipient: string;
  procurementAddress: string;
};

export type SolanaPaymentContext = ExecutionContext & Pick<StandingOrder, "service" | "maxLatencyMs">;

export interface SolanaSettlement {
  isReady(): boolean;
  pay(provider: Provider, amount: number, context: SolanaPaymentContext): Promise<SolanaSettlementReceipt>;
  markBreached(procurementId: string): Promise<BreachReceipt>;
}

export type SolanaSettlementConfig = {
  cluster: SolanaCluster;
  rpcUrl: string;
  rpcSubscriptionsUrl?: string;
  keypairPath: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  registryProgramId: string;
};

type ProviderEndpoints = Record<string, string | undefined>;
type ProviderPaymentAddresses = Record<string, string | undefined>;

export class KitSolanaSettlement implements SolanaSettlement {
  constructor(private readonly config: SolanaSettlementConfig) {}

  isReady() {
    return Boolean(
      this.config.rpcUrl
      && this.config.keypairPath
      && existsSync(this.config.keypairPath)
      && isValidSolanaAddress(this.config.tokenMint)
      && isValidSolanaAddress(this.config.registryProgramId)
      && Number.isInteger(this.config.tokenDecimals)
      && this.config.tokenDecimals >= 0
      && this.config.tokenDecimals <= 18,
    );
  }

  async pay(provider: Provider, amount: number, context: SolanaPaymentContext): Promise<SolanaSettlementReceipt> {
    if (!this.isReady()) throw new Error("Solana settlement is not configured");
    if (!provider.paymentAddress) throw new Error(`No Solana payment address configured for ${provider.name}`);

    const client = await this.createClient();
    const amountBaseUnits = toBaseUnits(amount, this.config.tokenDecimals);
    const transferPlan = await client.token.instructions.transferToATA({
      mint: address(this.config.tokenMint),
      authority: client.payer,
      recipient: address(provider.paymentAddress),
      amount: amountBaseUnits,
      decimals: this.config.tokenDecimals,
    });
    const registryInput = {
      buyer: client.payer,
      programId: address(this.config.registryProgramId),
      procurementId: context.procurementId,
    };
    const registry = context.replacement
      ? await getReplaceProviderInstruction({
        ...registryInput,
        replacement: address(provider.paymentAddress),
        replacementAmount: amountBaseUnits,
      })
      : await getCreateProcurementInstruction({
        ...registryInput,
        service: context.service,
        provider: address(provider.paymentAddress),
        tokenMint: address(this.config.tokenMint),
        amount: amountBaseUnits,
        maxLatencyMs: context.maxLatencyMs,
      });
    const result = await client.sendTransaction(nonDivisibleSequentialInstructionPlan([
      transferPlan,
      registry.instruction,
    ]));
    const signature = String(result.context.signature);

    return {
      signature,
      explorerUrl: solanaExplorerUrl(signature, this.config.cluster),
      amount,
      token: this.config.tokenSymbol,
      recipient: provider.paymentAddress,
      procurementAddress: registry.procurementAddress,
    };
  }

  async markBreached(procurementId: string): Promise<BreachReceipt> {
    if (!this.isReady()) throw new Error("Solana settlement is not configured");
    const client = await this.createClient();
    const registry = await getMarkBreachedInstruction({
      buyer: client.payer,
      programId: address(this.config.registryProgramId),
      procurementId,
    });
    const result = await client.sendTransaction(registry.instruction);
    const signature = String(result.context.signature);
    return {
      signature,
      explorerUrl: solanaExplorerUrl(signature, this.config.cluster),
      procurementAddress: registry.procurementAddress,
    };
  }

  private async createClient() {
    const signerClient = await createClient().use(signerFromFile(this.config.keypairPath));
    return signerClient
      .use(solanaRpc({
        rpcUrl: this.config.rpcUrl as `http${string}`,
        rpcSubscriptionsUrl: this.config.rpcSubscriptionsUrl as `ws${string}` | undefined,
      }))
      .use(tokenProgram());
  }
}

export class SolanaExecutionAdapter implements ExecutionAdapter {
  readonly mode = "solana" as const;

  constructor(
    private readonly settlement: SolanaSettlement = new KitSolanaSettlement(readSolanaSettlementConfig()),
    private readonly endpoints: ProviderEndpoints = readSolanaProviderEndpoints(),
    private readonly request: typeof fetch = fetch,
    private readonly paymentAddresses: ProviderPaymentAddresses = readSolanaProviderPaymentAddresses(),
  ) {}

  isReady() {
    const configuredProviders = Object.values(this.endpoints).filter(Boolean);
    const configuredRecipients = Object.values(this.paymentAddresses).filter(Boolean);
    return this.settlement.isReady()
      && configuredProviders.length >= 2
      && configuredProviders.every((endpoint) => isValidHttpUrl(endpoint!))
      && configuredRecipients.length >= 2
      && configuredRecipients.every((recipient) => isValidSolanaAddress(recipient!));
  }

  async execute(provider: Provider, order: StandingOrder, context?: ExecutionContext): Promise<ExecutionResult> {
    const endpoint = provider.endpoint ?? this.endpoints[provider.id];
    if (!endpoint) throw new Error(`No service endpoint configured for ${provider.name}`);
    if (!context) throw new Error("Solana procurement context is required");

    const payableProvider = provider.paymentAddress
      ? provider
      : { ...provider, paymentAddress: this.paymentAddresses[provider.id] };
    const payment = await this.settlement.pay(payableProvider, provider.price, {
      ...context,
      service: order.service,
      maxLatencyMs: order.maxLatencyMs,
    });
    const startedAt = Date.now();
    try {
      const response = await this.request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${order.id}:${payment.signature}`,
        },
        body: JSON.stringify({
          service: order.service,
          standingOrderId: order.id,
          paymentSignature: payment.signature,
        }),
      });
      const output = await response.json().catch(() => null);
      const latencyMs = Date.now() - startedAt;
      return {
        executionId: `solana_${payment.signature}`,
        success: response.ok,
        latencyMs,
        output,
        transactionHash: payment.signature,
        transactionLink: payment.explorerUrl,
        error: response.ok ? null : `Provider returned HTTP ${response.status}`,
        paid: true,
        amount: payment.amount,
        paymentProtocol: "spl",
        procurementAddress: payment.procurementAddress,
      };
    } catch (error) {
      return {
        executionId: `solana_${payment.signature}`,
        success: false,
        latencyMs: Date.now() - startedAt,
        output: null,
        transactionHash: payment.signature,
        transactionLink: payment.explorerUrl,
        error: error instanceof Error ? error.message : "Provider request failed",
        paid: true,
        amount: payment.amount,
        paymentProtocol: "spl",
        procurementAddress: payment.procurementAddress,
      };
    }
  }

  markBreached(procurementId: string) {
    return this.settlement.markBreached(procurementId);
  }
}

export function readSolanaSettlementConfig(env: NodeJS.ProcessEnv = process.env): SolanaSettlementConfig {
  const configuredCluster = env.SOLANA_CLUSTER || "devnet";
  if (configuredCluster !== "devnet" && configuredCluster !== "mainnet-beta") {
    throw new Error("SOLANA_CLUSTER must be devnet or mainnet-beta");
  }
  const cluster = configuredCluster;
  const keypairPath = env.SOLANA_KEYPAIR_PATH ? path.resolve(env.SOLANA_KEYPAIR_PATH) : "";
  return {
    cluster,
    rpcUrl: env.SOLANA_RPC_URL ?? "",
    rpcSubscriptionsUrl: env.SOLANA_RPC_SUBSCRIPTIONS_URL || undefined,
    keypairPath,
    tokenMint: env.SOLANA_TOKEN_MINT ?? "",
    tokenSymbol: env.SOLANA_TOKEN_SYMBOL || "USDC",
    tokenDecimals: parseTokenDecimals(env.SOLANA_TOKEN_DECIMALS),
    registryProgramId: env.SOLANA_REGISTRY_PROGRAM_ID || RESOURCE_REGISTRY_PROGRAM_ID,
  };
}

export function readSolanaProviderEndpoints(env: NodeJS.ProcessEnv = process.env): ProviderEndpoints {
  const baseUrl = (env.RESOURCE_PROVIDER_BASE_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  return {
    sentinel: env.RESOURCE_PROVIDER_SENTINEL_URL || (baseUrl ? `${baseUrl}/api/provider-services/sentinel/risk` : undefined),
    atlas: env.RESOURCE_PROVIDER_ATLAS_URL || (baseUrl ? `${baseUrl}/api/provider-services/atlas/risk` : undefined),
  };
}

export function readSolanaProviderPaymentAddresses(env: NodeJS.ProcessEnv = process.env): ProviderPaymentAddresses {
  return {
    sentinel: env.RESOURCE_PROVIDER_SENTINEL_SOLANA_ADDRESS,
    atlas: env.RESOURCE_PROVIDER_ATLAS_SOLANA_ADDRESS,
  };
}

export function toBaseUnits(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be positive");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Token decimals must be an integer from 0 to 18");
  const scale = 10 ** decimals;
  const scaled = amount * scale;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-6) {
    throw new Error(`Payment amount has more than ${decimals} decimal places`);
  }
  return BigInt(rounded);
}

export function solanaExplorerUrl(signature: string, cluster: SolanaCluster) {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return cluster === "devnet" ? `${base}?cluster=devnet` : base;
}

function parseTokenDecimals(value: string | undefined) {
  if (value === undefined || value === "") return 6;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function isValidSolanaAddress(value: string) {
  try {
    address(value);
    return true;
  } catch {
    return false;
  }
}

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
