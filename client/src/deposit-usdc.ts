/**
 * Deposit USDC (factice) into the RIFT vault.
 *
 * Usage:
 *   bun run src/deposit-usdc.ts <AMOUNT_USDC>
 *
 * AMOUNT_USDC is in whole USDC (e.g. 100 = 100 USDC = 100_000_000 atomics).
 */

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
    getProgram,
    deriveVaultConfigPda,
    deriveCpiAuthorityPda,
    explorerUrl,
    explorerAccountUrl,
} from "./config.ts";

async function deposit(amountArg: string) {
    const { program, provider, payer } = getProgram();
    const connection = provider.connection;

    const amountWhole = Number(amountArg);
    if (!Number.isFinite(amountWhole) || amountWhole <= 0) {
        throw new Error(`invalid amount: ${amountArg}`);
    }
    const atomics = BigInt(Math.floor(amountWhole * 1e6)); // USDC 6 decimals

    const [vaultConfigPda] = deriveVaultConfigPda();
    const [cpiAuthority] = deriveCpiAuthorityPda();

    const cfgInfo = await connection.getAccountInfo(vaultConfigPda);
    if (!cfgInfo) {
        throw new Error(
            "VaultConfig PDA not initialized - run initialize-vault.ts first.",
        );
    }
    // Skip disc(16) + dwallet_id(32) + authority(32) + usdc_mint...
    const usdcMint = new PublicKey(cfgInfo.data.subarray(8 + 32 + 32, 8 + 32 + 32 + 32));

    const depositorAta = await getAssociatedTokenAddress(
        usdcMint,
        payer.publicKey,
    );

    // Ensure the vault's USDC ATA exists (owned by cpi_authority PDA).
    const vaultAtaAcct = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdcMint,
        cpiAuthority,
        true, // allowOwnerOffCurve (PDA owner)
    );

    console.log("\n════════ RIFT Vault: deposit_usdc ════════\n");
    console.log("USDC Mint     :", usdcMint.toBase58());
    console.log("Depositor ATA :", depositorAta.toBase58());
    console.log("Vault USDC ATA:", vaultAtaAcct.address.toBase58());
    console.log("Amount        :", amountWhole, "USDC (", atomics.toString(), "atomic)");
    console.log();

    const sig = await program.methods
        .depositUsdc(new (await import("@coral-xyz/anchor")).BN(atomics.toString()))
        .accountsPartial({
            vaultConfig: vaultConfigPda,
            depositor: payer.publicKey,
            depositorAta,
            vaultUsdcAta: vaultAtaAcct.address,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payer])
        .rpc();

    console.log("✓ Deposit succeeded");
    console.log("  TX     :", explorerUrl(sig));
    console.log("  Vault  :", explorerAccountUrl(vaultAtaAcct.address));
    console.log();
}

const [amountArg] = process.argv.slice(2);
if (!amountArg) {
    console.error("Usage: bun run src/deposit-usdc.ts <AMOUNT_USDC>");
    process.exit(1);
}
deposit(amountArg).catch((err) => {
    console.error("\x1b[31m✗<x1b[0m", err);
    process.exit(1);
});
