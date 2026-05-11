/**
 * Initialize the RIFT Vault config PDA and bind it to an Ika dWallet.
 *
 * Usage:
 *   bun run src/initialize-vault.ts <IKA_DWALLET_ID_BASE58> [USDC_MINT]
 *
 * Note: In production the dWallet is created off-chain via Ika gRPC DKG,
 * then its authority is transferred to our cpi_authority PDA (seed
 * b__ika_cpi_authority). For demo we can pass any pubkey to exercise the wiring.
 */

import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    getProgram,
    deriveVaultConfigPda,
    deriveCpiAuthorityPda,
    USDC_MINT_DEVNET,
    explorerUrl,
    explorerAccountUrl,
} from "./config.ts";

async function initVault(dwalletIdArg: string, usdcMintArg?: string) {
    const { program, payer } = getProgram();
    const dwalletId = new PublicKey(dwalletIdArg);
    const usdcMint = usdcMintArg
        ? new PublicKey(usdcMintArg)
        : USDC_MINT_DEVNET;
    const [vaultConfig] = deriveVaultConfigPda();
    const [cpiAuthority, cpiAuthorityBump] = deriveCpiAuthorityPda();

    console.log("\n══════════ RIFT Vault: initialize_vault ══════════\n");
    console.log("dWallet ID    :", dwalletId.toBase58());
    console.log("USDC Mint    :", usdcMint.toBase58());
    console.log("Vault Config :", vaultConfig.toBase58());
    console.log(`CPI Authority : ${cpiAuthority.toBase58()} (bump ${cpiAuthorityBump})`);
    console.log("Authority     :", payer.publicKey.toBase58());
    console.log();

    const existing = await program.provider.connection.getAccountInfo(
        vaultConfig,
    );
    if (existing) {
        console.log("⚠ Vault config already initialized — skipping.");
        console.log("   View:", explorerAccountUrl(vaultConfig));
        return;
    }

    const sig = await program.methods
        .initializeVault(dwalletId)
        .accountsPartial({
            vaultConfig,
            cpiAuthority,
            usdcMint,
            authority: payer.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

    console.log("✓ VaultConfig initialized");
    console.log("  TX     :", explorerUrl(sig));
    console.log("  Vault  :", explorerAccountUrl(vaultConfig));
    console.log();
}

const [dwalletIdArg, usdcMintArg] = process.argv.slice(2);
if (!dwalletIdArg) {
    console.error("Usage: bun run src/initialize-vault.ts <IKA_DWALLET_ID> [USDC_MINT]");
    process.exit(1);
}
initVault(dwalletIdArg, usdcMintArg).catch((err) => {
    console.error("\x1b[31m✗\x1b[0m", err);
    process.exit(1);
});
