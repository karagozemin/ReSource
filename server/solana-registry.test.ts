import { address, generateKeyPairSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  getCreateProcurementInstruction,
  getMarkBreachedInstruction,
  getReplaceProviderInstruction,
  RESOURCE_REGISTRY_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "./solana-registry";

const PROVIDER_A = address("9xQeWvG816bUx9EPfEZr1yYF4hBzG6tS7dA8jJYhR6Lq");
const PROVIDER_B = address("Vote111111111111111111111111111111111111111");
const TOKEN_MINT = address("So11111111111111111111111111111111111111112");

describe("Solana procurement registry instructions", () => {
  it("derives one stable PDA for every lifecycle instruction", async () => {
    const buyer = await generateKeyPairSigner();
    const base = {
      buyer,
      programId: address(RESOURCE_REGISTRY_PROGRAM_ID),
      procurementId: "cycle_123",
    };
    const created = await getCreateProcurementInstruction({
      ...base,
      service: "token-risk-analysis",
      provider: PROVIDER_A,
      tokenMint: TOKEN_MINT,
      amount: 30_000n,
      maxLatencyMs: 15_000,
    });
    const breached = await getMarkBreachedInstruction(base);
    const replaced = await getReplaceProviderInstruction({
      ...base,
      replacement: PROVIDER_B,
      replacementAmount: 50_000n,
    });

    expect(created.procurementAddress).toBe(breached.procurementAddress);
    expect(created.procurementAddress).toBe(replaced.procurementAddress);
    expect([...created.instruction.data!.slice(0, 8)]).toEqual([155, 28, 113, 198, 42, 169, 60, 68]);
    expect([...breached.instruction.data!.slice(0, 8)]).toEqual([172, 209, 209, 147, 90, 189, 145, 13]);
    expect([...replaced.instruction.data!.slice(0, 8)]).toEqual([43, 45, 198, 130, 112, 80, 60, 130]);
  });

  it("matches the Anchor account order and binary layout", async () => {
    const buyer = await generateKeyPairSigner();
    const created = await getCreateProcurementInstruction({
      buyer,
      programId: address(RESOURCE_REGISTRY_PROGRAM_ID),
      procurementId: "cycle_layout",
      service: "token-risk-analysis",
      provider: PROVIDER_A,
      tokenMint: TOKEN_MINT,
      amount: 30_000n,
      maxLatencyMs: 15_000,
    });

    expect(created.instruction.data).toHaveLength(148);
    expect(created.instruction.accounts?.map((account) => account.address)).toEqual([
      buyer.address,
      created.procurementAddress,
      address(SYSTEM_PROGRAM_ID),
    ]);
  });
});
