# Rift Vault — USDC Custody with Ika 2PC-MPC Threshold Signatures

A Solana program that holds USDC and gates every withdrawal behind a fresh **Ika dWallet 2PC-MPC threshold signature**. No single key can drain the vault — withdrawals require a signature co-produced between the on-chain program's CPI authority PDA and the Ika network.

> **Submission**: Encrypt & Ika side track — Colosseum Frontier Hackathon 2026
> **Track scope**: bridgeless capital markets / Ika dWallet custody
> **Status**: live and verified end-to-end on Solana devnet

---

## The problem

Treasury custody on Solana relies on a single private key. If that key leaks — operator phone compromised, server breach, accidental keypair commit — the entire treasury is gone in a single transaction. Multisig helps but adds UX friction and still concentrates trust in a handful of co-signers.

For real-world products that hold user funds at scale — exchanges, custodians, lending markets, fiat-on-ramp operators — this is a hard constraint. We need a custody primitive where **no single party can move funds unilaterally**, while keeping latency low enough for production use.

## The approach

`rift-vault-ika` is a USDC vault on Solana that requires an Ika 2PC-MPC threshold signature on every withdrawal. The signing key materially does not exist in one place: it's split between the user-controlled side (the on-chain program's CPI authority PDA, owned by the Rift Vault program) and the Ika network side (computed via DKG and stored as a dWallet on Solana). Producing a signature requires both sides to cooperate; compromising one side alone gets you nothing.

The flow:

1. **DKG (one-time)** — Operator initiates a DKG with the Ika network via gRPC. The Ika network commits the resulting dWallet on-chain. Operator transfers authority of that dWallet to the Rift Vault program's `cpi_authority` PDA. From this point on, only the Rift Vault program can request signatures from this dWallet.
2. **Deposit** — Users deposit USDC into the vault PDA. The vault is a standard Anchor account holding the SPL token balance.
3. **Request withdrawal** — A user calls `request_withdraw(amount, dest, ...)`. The program builds a deterministic message digest (`keccak256("rift-withdraw-v1|<atomics>|<dest_ata>|<nonce>")`), creates a `WithdrawRequest` PDA, and CPIs into Ika's `approve_message` instruction. Ika creates a `MessageApproval` PDA with status=Pending.
4. **Threshold signing** — A signer service calls Ika's Presign + Sign gRPC endpoints with `ApprovalProof::Solana { tx_sig, slot }` pointing at the `approve_message` transaction. The Ika network produces a 64-byte Ed25519 signature using 2PC-MPC and commits it into the `MessageApproval` PDA, flipping status to Signed.
5. **Execute withdrawal** — A relayer calls `execute_withdraw`, which verifies the signature is present on-chain, transfers USDC from vault to destination ATA, and marks the request settled.

## What's working today (live on Solana devnet)

A full end-to-end flow has been executed and verified on devnet. Run `bash scripts/verify.sh` to check the 7-point proof. Sample run summary:

| Component | Address | Status |
|---|---|---|
| Rift Vault program | DFGhPRE6x6YWMKMcEwTrLMt6rBSwQDveq7bVC2Lm6XxZ | deployed (BPFLoaderUpgradeable) |
| Ika dWallet (DKG'd) | 54jCzFuk7FyfdZRExC2u7LC28EAJMRqVLrRbJNDqhfwy | owned by Ika, 153 bytes |
| Vault Config | C9a2ZhG5vqGEACsv9XY3wokYVnx3if2tdsCam21trTfh | initialized, 1000 USDC deposited |
| Withdraw Request (nonce=0) | G46EsymfWt5gK93QkGu4gBAjouHQhzXH4LZWP9rHfwbN | persisted, 122 bytes |
| Message Approval | Dhvzue2HZJSSR1ReTQVH9byEU81WoHm2i79VuqZpkqV1 | **status = Signed**, 312 bytes |
| 2PC-MPC signature (Ed25519, 64-byte) | 6b8ce23c...7e00 | committed on-chain |
| request_withdraw TX | [2HY2v1hp...q9YN](https://explorer.solana.com/tx/2HY2v1hpWRggeCnhu2ctutFekHr4krwJN6Vo9jikVU6A6BJWiGuRFZBi1yjeYV2rdEzj1VEfde9UMbVBgDiLq9YN?cluster=devnet) | finalized |

The signature was produced via live gRPC calls to `pre-alpha-dev-1.ika.ika-network.net:443` (Presign + Sign with `ApprovalProof::Solana`) and committed into the `MessageApproval` PDA by the Ika Network Outbound Agent.


## Repository layout

```
.
├── programs/rift-vault-ika/   Anchor program (Rust)
│   ├── src/lib.rs             Instructions: initialize_vault, deposit_usdc,
│   │                          request_withdraw, execute_withdraw
│   └── src/dwallet.rs         Ika CPI: approve_message encoding + invoke_signed
├── client/                    TypeScript scripts (Bun)
│   ├── src/initialize-vault.ts
│   ├── src/deposit-usdc.ts
│   └── src/request-withdraw.ts
├── scripts/verify.sh          End-to-end devnet verification (7 checks)
└── Anchor.toml                cluster = devnet, program_id deployed
```

The Presign + Sign client (off-chain signer service) is a Rust binary built on `ika-grpc` and `ika-dwallet-types` from `dwallet-labs/ika-pre-alpha`. It reads the persisted DKG attestation, reconstructs the same keccak digest the on-chain program used, and submits Presign + Sign with `ApprovalProof::Solana { transaction_signature, slot }` so the Ika network independently verifies the user's intent before producing a signature.

## Reproducing the flow on devnet

Requirements: Solana CLI 1.18+ or Agave 3.x, Anchor 0.32, Rust toolchain, Bun, `protoc` for the gRPC client.

```bash
# 1. Solana setup
solana config set --url devnet
solana airdrop 2

# 2. Build + deploy the program
anchor build
anchor deploy --provider.cluster devnet

# 3. DKG a dWallet against the Ika devnet network
#    (transfers authority to the Rift Vault's cpi_authority PDA)
./rift-ika-bootstrap init DFGhPRE6x6YWMKMcEwTrLMt6rBSwQDveq7bVC2Lm6XxZ

# 4. Initialize the vault, passing the freshly DKG'd dWallet PDA
cd client && bun install
bun run src/initialize-vault.ts <DWALLET_PDA>

# 5. Deposit some USDC (devnet test mint)
bun run src/deposit-usdc.ts 1000

# 6. Request a withdrawal — this CPIs into Ika approve_message
bun run src/request-withdraw.ts 100 <DEST_WALLET> <DWALLET_PUBKEY_HEX>

# 7. Produce the 2PC-MPC signature via Ika gRPC and commit it on-chain
./rift-ika-sign <REQUEST_WITHDRAW_TX_SIG> 100 <DEST_ATA> <NONCE>

# 8. Verify everything on-chain
bash scripts/verify.sh
```

## Why this is genuine Ika integration, not a checkbox

The Ika dWallet is not used as a generic signer for an arbitrary message. The program:

1. Derives the `MessageApproval` PDA with the same seed scheme Ika expects (`b"dwallet"` || (curve_u16 || pubkey) chunked into 32B || `b"message_approval"` || sig_scheme_u16 || message_digest).
2. Builds the `approve_message` instruction data byte-for-byte matching Ika's discriminator + Borsh layout (see `dwallet.rs::approve_message_data`).
3. CPIs with the program's own `cpi_authority` PDA as signer — the same PDA that owns the dWallet. This proves on-chain that the request originated from program logic, not an external caller.
4. The off-chain signer service uses `ApprovalProof::Solana` so the Ika network independently verifies the `approve_message` TX exists at the given slot before producing a signature. Ika is not a blind oracle — it cryptographically commits to the user's intent.

If you swap the dWallet for a vanilla keypair, you can drain the vault. If you swap it for the real one but disable the CPI, the Ika network refuses to sign. Each piece is load-bearing.


## Roadmap

The hackathon submission ships the custody primitive. Path to mainnet:

- **Frontend** — operator dashboard and end-user withdrawal UI
- **Mainnet dWallet** — re-DKG against Ika mainnet once the network ships
- **Multi-asset support** — generalize from USDC to any SPL / Token-2022 mint
- **Spending limits** — per-window and per-destination caps enforced on-chain
- **Recovery flow** — operator-side authority rotation via on-chain governance + a second Ika authorization

## Credits

- **Ika dWallet network** — 2PC-MPC threshold signing infrastructure (`dwallet-labs/ika-pre-alpha`)
- **Anchor / Solana Labs** — program framework
- Built solo by [@just-yamap](https://github.com/just-yamap) for Colosseum Frontier 2026.

