import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet.js";
import * as fs from "node:fs";
import * as path from "node:path";
import idl from "../../target/idl/rift_vault_ika.json" with { type: "json" };
import type { RiftVaultIka } from "../../target/types/rift_vault_ika.ts";

// == Cluster ==
export const SOLANA_RPC = "https://api.devnet.solana.com";

// == Program IDs ==
export const RIFT_VAULT_IKA_PROGRAM_ID = new PublicKey(idl.address);
export const IKA_PROGRAM_ID = new PublicKey(
    "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
);
// Devnet USDC (common test mint)
export const USDC_MINT_DEVNET = new PublicKey(
    "4zZmjaNXdirqDu1ENoNgcBA3oTpzvXJjDS4zJ2e8wYN3",
);

// == Seeds ==
export const VAULT_CONFIG_SEED = Buffer.from("vault-config");
export const WITHDRAW_REQUEST_SEED = Buffer.from("withdraw-request");
export const CPI_AUTHORITY_SEED = Buffer.from("__ika_cpi_authority");
export const IKA_DWALLET_SEED = Buffer.from("dwallet");
export const IKA_MESSAGE_APPROVAL_SEED = Buffer.from("message_approval");
export const IKA_COORDINATOR_SEED = Buffer.from("dwallet_coordinator");

// == Curve / Signature schemes ==
export const CURVE_CURVE25519 = 2;
export const SIG_EDDSA_SHA_512 = 5;

// == Helpers ==
export function loadKeypair(filepath?: string): Keypair {
    const keyPath =
        filepath ?? path.join(process.env.HOME!, ".config/solana/id.json");
    const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(raw));
}

export function getConnection(): Connection {
    return new Connection(SOLANA_RPC, "confirmed");
}

export function getProgram(payer = loadKeypair()): {
    program: Program<RiftVaultIka>;
    provider: AnchorProvider;
    payer: Keypair;
} {
    const connection = getConnection();
    const wallet = new NodeWallet(payer);
    const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    const program = new Program<RiftVaultIka>(idl as any, provider);
    return { program, provider, payer };
}

export function deriveVaultConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [VAULT_CONFIG_SEED],
        RIFT_VAULT_IKA_PROGRAM_ID,
    );
}

export function deriveCpiAuthorityPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [CPI_AUTHORITY_SEED],
        RIFT_VAULT_IKA_PROGRAM_ID,
    );
}

export function deriveWithdrawRequestPda(nonce: bigint): [PublicKey, number] {
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(nonce);
    return PublicKey.findProgramAddressSync(
        [WITHDRAW_REQUEST_SEED, nonceBuf],
        RIFT_VAULT_IKA_PROGRAM_ID,
    );
}

export function deriveCoordinatorPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [IKA_COORDINATOR_SEED],
        IKA_PROGRAM_ID,
    );
}

/** Pack curveu16le || public key for Ika dWallet seeds */
function packDwalletSeedPayload(curve: number, publicKey: Uint8Array): Buffer {
    const buf = Buffer.alloc(2 + publicKey.length);
    buf.writeUInt16LE(curve, 0);
    buf.set(publicKey, 2);
    return buf;
}

function chunkInto(buf: Buffer, size: number): Buffer[] {
    const out: Buffer[] = [];
    for (let i = 0; i < buf.length; i += size) {
        out.push(buf.subarray(i, Math.min(i + size, buf.length)));
    }
    return out;
}

export function deriveDwalletPda(
    curve: number,
    publicKey: Uint8Array,
): [PublicKey, number] {
    const payload = packDwalletSeedPayload(curve, publicKey);
    return PublicKey.findProgramAddressSync(
        [IKA_DWALLET_SEED, ...chunkInto(payload, 32)],
        IKA_PROGRAM_ID,
    );
}

export function deriveMessageApprovalPda(
    curve: number,
    dwalletPublicKey: Uint8Array,
    signatureScheme: number,
    messageDigest: Uint8Array,
    messageMetadataDigest?: Uint8Array,
): [PublicKey, number] {
    if (messageDigest.length !== 32) {
        throw new Error("message_digest must be 32 bytes");
    }
    const payload = packDwalletSeedPayload(curve, dwalletPublicKey);
    const schemeBuf = Buffer.alloc(2);
    schemeBuf.writeUInt16LE(signatureScheme);

    const seeds: Buffer[] = [
        IKA_DWALLET_SEED,
        ...chunkInto(payload, 32),
        IKA_MESSAGE_APPROVAL_SEED,
        schemeBuf,
        Buffer.from(messageDigest),
    ];

    if (
        messageMetadataDigest &&
        messageMetadataDigest.length === 32 &&
        !messageMetadataDigest.every((b) => b === 0)
    ) {
        seeds.push(Buffer.from(messageMetadataDigest));
    }

    return PublicKey.findProgramAddressSync(seeds, IKA_PROGRAM_ID);
}

export function explorerUrl(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAccountUrl(addr: PublicKey | string): string {
    const a = typeof addr === "string" ? addr : addr.toBase58();
    return `https://explorer.solana.com/address/${a}?cluster=devnet`;
}
