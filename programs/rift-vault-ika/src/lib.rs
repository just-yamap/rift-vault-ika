//! RIFT Vault — Ika dWallet 2PC-MPC custody for operator USDC liquidity.
//!
//! Current RIFT mainnet operator vault is a single hot keypair (FuePxPf2...).
//! Single point of failure for $1k+ live USDC. This program demonstrates the
//! migration path to Ika dWallet custody: every withdrawal requires 2PC-MPC
//! threshold signing (operator keyshare + Ika network keyshare), eliminating
//! single-key compromise risk while preserving same Anchor program interface.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

pub mod dwallet;
use dwallet::*;

declare_id!("DFGhPRE6x6YWMKMcEwTrLMt6rBSwQDveq7bVC2Lm6XxZ");

pub const VAULT_CONFIG_SEED: &[u8] = b"vault-config";
pub const WITHDRAW_REQUEST_SEED: &[u8] = b"withdraw-request";

#[program]
pub mod rift_vault_ika {
    use super::*;

    /// Initialize the vault config and bind it to an Ika dWallet.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        dwallet_id: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.vault_config;
        cfg.dwallet_id = dwallet_id;
        cfg.authority = ctx.accounts.authority.key();
        cfg.usdc_mint = ctx.accounts.usdc_mint.key();
        cfg.total_deposits = 0;
        cfg.total_withdrawals = 0;
        cfg.withdraw_nonce = 0;
        cfg.bump = ctx.bumps.vault_config;
        cfg.cpi_authority_bump = ctx.bumps.cpi_authority;

        emit!(VaultInitialized {
            dwallet_id,
            authority: cfg.authority,
            usdc_mint: cfg.usdc_mint,
            vault_config: ctx.accounts.vault_config.key(),
        });
        msg!("RIFT vault initialized with dWallet {}", dwallet_id);
        Ok(())
    }

    /// Anyone can deposit USDC into the vault.
    pub fn deposit_usdc(ctx: Context<DepositUsdc>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_ata.to_account_info(),
            to: ctx.accounts.vault_usdc_ata.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.vault_config.total_deposits = ctx
            .accounts
            .vault_config
            .total_deposits
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        emit!(VaultDeposit {
            depositor: ctx.accounts.depositor.key(),
            amount,
            total_deposits: ctx.accounts.vault_config.total_deposits,
        });
        msg!("Deposit: {} USDC (total: {})", amount, ctx.accounts.vault_config.total_deposits);
        Ok(())
    }

    /// Request a withdrawal: build the message digest, CPI into Ika approve_message.
    pub fn request_withdraw(
        ctx: Context<RequestWithdraw>,
        amount: u64,
        message_approval_bump: u8,
        message_digest: [u8; 32],
        message_metadata_digest: [u8; 32],
        user_pubkey: Pubkey,
        signature_scheme: u16,
    ) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let cfg = &mut ctx.accounts.vault_config;
        let nonce = cfg.withdraw_nonce;
        cfg.withdraw_nonce = nonce.checked_add(1).ok_or(VaultError::Overflow)?;

        let req = &mut ctx.accounts.withdraw_request;
        req.amount = amount;
        req.destination = ctx.accounts.destination_ata.key();
        req.message_digest = message_digest;
        req.message_approval = ctx.accounts.message_approval.key();
        req.status = WithdrawStatus::Pending;
        req.nonce = nonce;
        req.bump = ctx.bumps.withdraw_request;

        let ix_data = approve_message_data(
            message_approval_bump,
            &message_digest,
            &message_metadata_digest,
            &user_pubkey,
            signature_scheme,
        );
        invoke_approve_message(
            ix_data,
            &ctx.accounts.coordinator.to_account_info(),
            &ctx.accounts.message_approval.to_account_info(),
            &ctx.accounts.dwallet.to_account_info(),
            &ctx.accounts.caller_program.to_account_info(),
            &ctx.accounts.cpi_authority.to_account_info(),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.ika_program.to_account_info(),
            cfg.cpi_authority_bump,
        )?;

        emit!(WithdrawRequested {
            amount,
            destination: req.destination,
            nonce,
            message_digest,
            message_approval: req.message_approval,
        });
        msg!("Withdraw requested: {} USDC, nonce={}, awaiting Ika 2PC-MPC sig", amount, nonce);
        Ok(())
    }

    /// Execute the withdrawal after Ika has signed the message.
    pub fn execute_withdraw(ctx: Context<ExecuteWithdraw>) -> Result<()> {
        let req = &mut ctx.accounts.withdraw_request;
        require!(req.status == WithdrawStatus::Pending, VaultError::AlreadySettled);
        let cfg = &ctx.accounts.vault_config;
        let amount = req.amount;

        let seeds: &[&[u8]] = &[CPI_AUTHORITY_SEED, &[cfg.cpi_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_usdc_ata.to_account_info(),
            to: ctx.accounts.destination_ata.to_account_info(),
            authority: ctx.accounts.cpi_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        req.status = WithdrawStatus::Settled;
        let cfg_mut = &mut ctx.accounts.vault_config;
        cfg_mut.total_withdrawals = cfg_mut.total_withdrawals.checked_add(amount).ok_or(VaultError::Overflow)?;

        emit!(WithdrawExecuted {
            amount,
            destination: req.destination,
            nonce: req.nonce,
            total_withdrawals: cfg_mut.total_withdrawals,
        });
        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct VaultConfig {
    pub dwallet_id: Pubkey,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub total_deposits: u64,
    pub total_withdrawals: u64,
    pub withdraw_nonce: u64,
    pub bump: u8,
    pub cpi_authority_bump: u8,
}
impl VaultConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum WithdrawStatus {
    Pending,
    Settled,
}

impl Default for WithdrawStatus {
    fn default() -> Self { Self::Pending }
}

#[account]
#[derive(Default)]
pub struct WithdrawRequest {
    pub amount: u64,
    pub destination: Pubkey,
    pub message_digest: [u8; 32],
    pub message_approval: Pubkey,
    pub status: WithdrawStatus,
    pub nonce: u64,
    pub bump: u8,
}
impl WithdrawRequest {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 32 + 1 + 8 + 1;
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = VaultConfig::LEN,
        seeds = [VAULT_CONFIG_SEED],
        bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,
    /// CHECK: PDA derived from a fixed seed.
    #[account(
        seeds = [CPI_AUTHORITY_SEED],
        bump,
    )]
    pub cpi_authority: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositUsdc<'info> {
    #[account(mut, seeds = [VAULT_CONFIG_SEED], bump = vault_config.bump)]
    pub vault_config: Account<'info, VaultConfig>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub depositor_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(mut, seeds = [VAULT_CONFIG_SEED], bump = vault_config.bump)]
    pub vault_config: Account<'info, VaultConfig>,
    #[account(
        init,
        payer = payer,
        space = WithdrawRequest::LEN,
        seeds = [WITHDRAW_REQUEST_SEED, &vault_config.withdraw_nonce.to_le_bytes()],
        bump,
    )]
    pub withdraw_request: Account<'info, WithdrawRequest>,
    pub destination_ata: Account<'info, TokenAccount>,
    /// CHECK: Ika coordinator.
    pub coordinator: UncheckedAccount<'info>,
    /// CHECK: MessageApproval PDA.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,
    /// CHECK: dWallet.
    pub dwallet: UncheckedAccount<'info>,
    /// CHECK: caller program ID (our program).
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: cpi_authority PDA.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump = vault_config.cpi_authority_bump)]
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Ika program.
    #[account(address = IKA_PROGRAM_ID)]
    pub ika_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteWithdraw<'info> {
    #[account(mut, seeds = [VAULT_CONFIG_SEED], bump = vault_config.bump)]
    pub vault_config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [WITHDRAW_REQUEST_SEED, &withdraw_request.nonce.to_le_bytes()], bump = withdraw_request.bump)]
    pub withdraw_request: Account<'info, WithdrawRequest>,
    /// CHECK: cpi_authority PDA.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump = vault_config.cpi_authority_bump)]
    pub cpi_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut, address = withdraw_request.destination)]
    pub destination_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct VaultInitialized {
    pub dwallet_id: Pubkey,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault_config: Pubkey,
}

#[event]
pub struct VaultDeposit {
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_deposits: u64,
}

#[event]
pub struct WithdrawRequested {
    pub amount: u64,
    pub destination: Pubkey,
    pub nonce: u64,
    pub message_digest: [u8; 32],
    pub message_approval: Pubkey,
}

#[event]
pub struct WithdrawExecuted {
    pub amount: u64,
    pub destination: Pubkey,
    pub nonce: u64,
    pub total_withdrawals: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Withdrawal already settled")]
    AlreadySettled,
}
