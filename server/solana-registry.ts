import { createHash } from "node:crypto";
import {
  AccountRole,
  address,
  fixEncoderSize,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  getStructEncoder,
  getU32Encoder,
  getU64Encoder,
  type Address,
  type AccountSignerMeta,
  type Instruction,
  type InstructionWithSigners,
  type TransactionSigner,
} from "@solana/kit";

export const RESOURCE_REGISTRY_PROGRAM_ID = "G3sta1z39YXTX5dopAXtuv6kqBTQGoN9G85DMW3WVvm4";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

const PROCUREMENT_SEED = new TextEncoder().encode("procurement");
const CREATE_PROCUREMENT_DISCRIMINATOR = new Uint8Array([155, 28, 113, 198, 42, 169, 60, 68]);
const MARK_BREACHED_DISCRIMINATOR = new Uint8Array([172, 209, 209, 147, 90, 189, 145, 13]);
const REPLACE_PROVIDER_DISCRIMINATOR = new Uint8Array([43, 45, 198, 130, 112, 80, 60, 130]);
const bytes32Encoder = fixEncoderSize(getBytesEncoder(), 32);

export type ProcurementInstructionInput = {
  buyer: TransactionSigner;
  programId: Address;
  procurementId: string;
};

export type CreateProcurementInstructionInput = ProcurementInstructionInput & {
  service: string;
  provider: Address;
  tokenMint: Address;
  amount: bigint;
  maxLatencyMs: number;
};

export type ReplaceProviderInstructionInput = ProcurementInstructionInput & {
  replacement: Address;
  replacementAmount: bigint;
};

export type RegistryInstruction = {
  instruction: Instruction & InstructionWithSigners;
  procurementAddress: Address;
  procurementIdHash: Uint8Array;
};

export async function getCreateProcurementInstruction(
  input: CreateProcurementInstructionInput,
): Promise<RegistryInstruction> {
  const derived = await deriveProcurement(input);
  const buyerAccount: AccountSignerMeta = {
    address: input.buyer.address,
    role: AccountRole.WRITABLE_SIGNER,
    signer: input.buyer,
  };
  const encoder = getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["procurementId", bytes32Encoder],
    ["service", bytes32Encoder],
    ["provider", getAddressEncoder()],
    ["tokenMint", getAddressEncoder()],
    ["amount", getU64Encoder()],
    ["maxLatencyMs", getU32Encoder()],
  ]);

  return {
    ...derived,
    instruction: {
      programAddress: input.programId,
      accounts: [
        buyerAccount,
        { address: derived.procurementAddress, role: AccountRole.WRITABLE },
        { address: address(SYSTEM_PROGRAM_ID), role: AccountRole.READONLY },
      ],
      data: encoder.encode({
        discriminator: CREATE_PROCUREMENT_DISCRIMINATOR,
        procurementId: derived.procurementIdHash,
        service: hash32(input.service),
        provider: input.provider,
        tokenMint: input.tokenMint,
        amount: input.amount,
        maxLatencyMs: input.maxLatencyMs,
      }),
    },
  };
}

export async function getMarkBreachedInstruction(
  input: ProcurementInstructionInput,
): Promise<RegistryInstruction> {
  const derived = await deriveProcurement(input);
  const buyerAccount: AccountSignerMeta = {
    address: input.buyer.address,
    role: AccountRole.READONLY_SIGNER,
    signer: input.buyer,
  };
  const encoder = getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["procurementId", bytes32Encoder],
  ]);

  return {
    ...derived,
    instruction: {
      programAddress: input.programId,
      accounts: [
        buyerAccount,
        { address: derived.procurementAddress, role: AccountRole.WRITABLE },
      ],
      data: encoder.encode({
        discriminator: MARK_BREACHED_DISCRIMINATOR,
        procurementId: derived.procurementIdHash,
      }),
    },
  };
}

export async function getReplaceProviderInstruction(
  input: ReplaceProviderInstructionInput,
): Promise<RegistryInstruction> {
  const derived = await deriveProcurement(input);
  const buyerAccount: AccountSignerMeta = {
    address: input.buyer.address,
    role: AccountRole.READONLY_SIGNER,
    signer: input.buyer,
  };
  const encoder = getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["procurementId", bytes32Encoder],
    ["replacement", getAddressEncoder()],
    ["replacementAmount", getU64Encoder()],
  ]);

  return {
    ...derived,
    instruction: {
      programAddress: input.programId,
      accounts: [
        buyerAccount,
        { address: derived.procurementAddress, role: AccountRole.WRITABLE },
      ],
      data: encoder.encode({
        discriminator: REPLACE_PROVIDER_DISCRIMINATOR,
        procurementId: derived.procurementIdHash,
        replacement: input.replacement,
        replacementAmount: input.replacementAmount,
      }),
    },
  };
}

export function hash32(value: string) {
  return new Uint8Array(createHash("sha256").update(value, "utf8").digest());
}

async function deriveProcurement(input: ProcurementInstructionInput) {
  const procurementIdHash = hash32(input.procurementId);
  const [procurementAddress] = await getProgramDerivedAddress({
    programAddress: input.programId,
    seeds: [PROCUREMENT_SEED, getAddressEncoder().encode(input.buyer.address), procurementIdHash],
  });
  return { procurementAddress, procurementIdHash };
}
