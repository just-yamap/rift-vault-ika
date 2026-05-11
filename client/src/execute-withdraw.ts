/**
 * Execute a pending withdrawal — final step of the Rift Vault Ika flow.
 *
 * After request_withdraw has CPI'd into Ika's approve_message and the Ika
 * network has produced the 2PC-MPC signature (committed into MessageApproval
 * with status=Signed), this instruction transfers USDC from the vault PDA
 * to the destination ATA, signed by the cpi_authority PDA.
 *
 * Usage:
 *   bun run src/execute-withdraw.ts <NONCE>
 *
 * The NONCE is the withdraw_nonce of the request to settle (e.g. 0 for
 * the first request).
 */

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
    getProgram,
    deriveVaultConfigPda,
    deriveCpiAuthorityPda,
    deriveWithdrawRequestPda,
    explorerUrl,
    explorerAccountUrl,
} from "./config.ts";

async function executeWithdraw(nonceArg: string) {
    const { program, provider, payer } = getProgram();
    const connection = provider.connection;

    const nonce = BigInt(nonceArg);

    const [vaultConfigPda] = deriveVaultConfigPda();
    const [cpiAuthority] = deriveCpiAuthorityPda();
    const [withdrawRequest] = deriveWithdrawRequestPda(nonce);

    // Load VaultConfig to read USDC mint and vault USDC ATA
    const cfgInfo = await connection.getAccountInfo(vaultConfigPda);
    if (!cfgInfo) throw new Error("VaultConfig not initialized");
    // VaultConfig layout: discriminator(8) + authority(32) + dwallet(32) + usdc_mint(32) + ...
    const usdcMint = new PublicKey(cfgInfo.data.subarray(8 + 32 + 32, 8 + 32 + 32 + 32));

    // Vault holds USDC in its ATA, owned by cpi_authority PDA
    const vaultUsdcAta = await getAssociatedTokenAddress(
        usdcMint,
        cpiAuthority,
        true, // allowOwnerOffCurve - cpi_authority is a PDA
    );

    // Load WithdrawRequest to get destination ATA + amount
    const reqInfo = await connection.getAccountInfo(withdrawRequest);
    if (!reqInfo) throw new Error(`WithdrawRequest for nonce ${nonce} not found`);
    // WithdrawRequest layout: discriminator(8) + amount(8) + destination(32) + ...
    const amount = reqInfo.data.readBigUInt64LE(8);
    const destinationAta = new PublicKey(reqInfo.data.subarray(8 + 8, 8 + 8 + 32));
    const status = reqInfo.data.readUInt8(reqInfo.data.length - 2);

    console.log("\n════════ RIFT Vault: execute_withdraw ════════\n");
    console.log("Nonce          :", nonce.toString());
    console.log("Amount         :", Number(amount) / 1e6, "USDC");
    console.log("Vault USDC ATA :", vaultUsdcAta.toBase58());
    console.log("Destination ATA:", destinationAta.toBase58());
    console.log("WithdrawRequest:", withdrawRequest.toBase58());
    console.log("Status byte    :", status, status === 0 ? "(Pending - good)" : status === 1 ? "(already Settled)" : "(unknown)");
    console.log();

    if (status === 1) {
        console.log("\x1b[33m⚠\x1b[0m Already settled. Nothing to do.");
        return;
    }

    // Build + send the instruction
    const { Transaction } = await import("@solana/web3.js");
    const ix = await program.methods
        .executeWithdraw()
        .accountsPartial({
            vaultConfig: vaultConfigPda,
            withdrawRequest,
            cpiAuthority,
            vaultUsdcAta,
            destinationAta,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
    });

    console.log("TX sent, waiting for confirmation...");
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
    );

    console.log("\x1b[32m✓\x1b[0m execute_withdraw succeeded");
    console.log("  TX             :", explorerUrl(sig));
    console.log("  WithdrawRequest:", explorerAccountUrl(withdrawRequest));
    console.log("  Destination ATA:", explorerAccountUrl(destinationAta));
    console.log();
    console.log("\x1b[32m✓\x1b[0m", Number(amount) / 1e6, "USDC transferred from vault → destination");
    console.log();
}

const [nonceArg] = process.argv.slice(2);
if (!nonceArg) {
    console.error("Usage: bun run src/execute-withdraw.ts <NONCE>");
    process.exit(1);
}
executeWithdraw(nonceArg).catch((err) => {
    console.error("\x1b[31m✗\x1b[0m", err);
    process.exit(1);
});
