import { describe, expect, it, vi } from "vitest";
import { initialProviders, standingOrder } from "../src/data/demo";
import {
  SolanaExecutionAdapter,
  solanaExplorerUrl,
  toBaseUnits,
  type SolanaSettlement,
} from "./solana";

const TEST_SOLANA_ADDRESS = "11111111111111111111111111111111";

describe("Solana settlement boundary", () => {
  it("converts configured token amounts to exact base units", () => {
    expect(toBaseUnits(0.03, 6)).toBe(30_000n);
    expect(toBaseUnits(1.25, 6)).toBe(1_250_000n);
    expect(() => toBaseUnits(0.0000001, 6)).toThrow("more than 6 decimal places");
  });

  it("builds cluster-correct explorer links", () => {
    expect(solanaExplorerUrl("signature", "devnet")).toBe("https://explorer.solana.com/tx/signature?cluster=devnet");
    expect(solanaExplorerUrl("signature", "mainnet-beta")).toBe("https://explorer.solana.com/tx/signature");
  });

  it("settles before calling the provider and returns transaction evidence", async () => {
    const actions: string[] = [];
    const settlement: SolanaSettlement = {
      isReady: () => true,
      pay: async (provider, amount) => {
        actions.push(`pay:${provider.id}`);
        expect(provider.paymentAddress).toBe(TEST_SOLANA_ADDRESS);
        return {
          signature: "solana-signature",
          explorerUrl: "https://explorer.solana.com/tx/solana-signature?cluster=devnet",
          amount,
          token: "USDC",
          recipient: provider.paymentAddress!,
        };
      },
    };
    const request = vi.fn(async () => {
      actions.push("execute:sentinel");
      return new Response(JSON.stringify({ riskLevel: "low", riskScore: 12, factors: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new SolanaExecutionAdapter(
      settlement,
      { sentinel: "https://sentinel.example/api", atlas: "https://atlas.example/api" },
      request,
      { sentinel: TEST_SOLANA_ADDRESS, atlas: TEST_SOLANA_ADDRESS },
    );

    expect(adapter.isReady()).toBe(true);
    const result = await adapter.execute(initialProviders.find((provider) => provider.id === "sentinel")!, standingOrder);

    expect(actions).toEqual(["pay:sentinel", "execute:sentinel"]);
    expect(result).toMatchObject({
      success: true,
      paid: true,
      amount: 0.03,
      paymentProtocol: "spl",
      transactionHash: "solana-signature",
      transactionLink: "https://explorer.solana.com/tx/solana-signature?cluster=devnet",
    });
  });

  it("preserves payment evidence when the paid provider fails", async () => {
    const settlement: SolanaSettlement = {
      isReady: () => true,
      pay: async (provider, amount) => ({
        signature: "paid-signature",
        explorerUrl: "https://explorer.solana.com/tx/paid-signature?cluster=devnet",
        amount,
        token: "USDC",
        recipient: provider.paymentAddress!,
      }),
    };
    const adapter = new SolanaExecutionAdapter(
      settlement,
      { sentinel: "https://sentinel.example/api", atlas: "https://atlas.example/api" },
      async () => new Response("unavailable", { status: 503 }),
      { sentinel: TEST_SOLANA_ADDRESS, atlas: TEST_SOLANA_ADDRESS },
    );

    const result = await adapter.execute(initialProviders.find((provider) => provider.id === "sentinel")!, standingOrder);
    expect(result).toMatchObject({ success: false, paid: true, amount: 0.03, transactionHash: "paid-signature" });
  });
});
