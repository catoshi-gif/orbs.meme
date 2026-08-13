#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

// PLACEHOLDER PROGRAM ID.
// Before any deployment, generate the real program keypair and run `anchor keys sync`.
declare_id!("HbBoHU9bT4eFSvGW7zjZFy7nEMN2dPKGt5wCd7ePKbPv");

// -----------------------------------------------------------------------------
// Fixed production identities
// -----------------------------------------------------------------------------

/// Production Orbs.meme treasury. SPL protocol fees may only reach the
/// canonical ATA owned by this wallet for the Orb's mint. There is no setter.
#[cfg(not(feature = "local-testing"))]
pub const ORBS_TREASURY: Pubkey =
    pubkey!("5mEqxr6McBRL5DGE9dJ2Td3viwhAmRpe4V7pqGTPMtvr");

/// Production relayer/rent receiver. This key has NO SPL custody or settlement
/// authority. It only receives reclaimed lamports when temporary accounts close.
#[cfg(not(feature = "local-testing"))]
pub const ORBS_RENT_RECEIVER: Pubkey =
    pubkey!("GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN");

// Deterministic local-only identities so tests can hold the private keys.
// NEVER deploy a production build with `local-testing` enabled.
#[cfg(feature = "local-testing")]
pub const ORBS_TREASURY: Pubkey =
    pubkey!("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
#[cfg(feature = "local-testing")]
pub const ORBS_RENT_RECEIVER: Pubkey =
    pubkey!("9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu");

pub const CONFIG_SEED: &[u8] = b"config";
pub const ORB_SEED: &[u8] = b"orb";
pub const HOST_POLICY_SEED: &[u8] = b"host-policy";
pub const CURRENT_VERSION: u8 = 1;

/// Product economics are quoted off-chain because arbitrary SPL token prices
/// cannot be proven without an oracle. The immutable V1 policy is $1.15 per Orb.
pub const ORBS_FEE_USD_MICROS: u64 = 1_150_000;
pub const MIN_PRIZE_USD_MICROS: u64 = 5_000_000;
/// Independent fail-safe: because prize and fee use the same mint, a genuine
/// $1.15 fee on a >=$5 prize should remain below 23% before atomic rounding.
/// Allow 25% to absorb safe upward rounding while rejecting grossly malformed
/// or malicious fee quotes even if the low-custody quote signer is compromised.
pub const MAX_FEE_BPS_OF_PRIZE: u128 = 2_500;

/// A fee/prize quote must be short-lived. The quote authority signs the exact
/// creation transaction, so the client cannot alter mint/amounts after signing.
pub const MAX_QUOTE_TTL_SECONDS: i64 = 10 * 60;

/// Production game timing is intentionally fixed on-chain so a compromised
/// frontend or quote service cannot create an Orb with a surprising custody window.
#[cfg(not(feature = "local-testing"))]
pub const MIN_START_LEAD_SECONDS: i64 = 30;
#[cfg(feature = "local-testing")]
pub const MIN_START_LEAD_SECONDS: i64 = 1;

pub const MAX_START_DELAY_SECONDS: i64 = 30 * 24 * 60 * 60;

#[cfg(not(feature = "local-testing"))]
pub const SETTLEMENT_WINDOW_SECONDS: i64 = 6 * 60 * 60;
#[cfg(feature = "local-testing")]
pub const SETTLEMENT_WINDOW_SECONDS: i64 = 12;

/// Development/admin creator that may create concurrent Orbs for testing. This
/// exception affects only the one-active-Orb policy; it grants no custody power.
#[cfg(not(feature = "local-testing"))]
pub const ORBS_ADMIN_CREATOR: Pubkey =
    pubkey!("EDxq8pn8assS3Zoco5UBm3suPNu6oum3fzEwCsZixWC4");
#[cfg(feature = "local-testing")]
pub const ORBS_ADMIN_CREATOR: Pubkey =
    pubkey!("AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa");

// -----------------------------------------------------------------------------
// Program
// -----------------------------------------------------------------------------

#[program]
pub mod orbs_protocol {
    use super::*;

    /// One-time immutable protocol initialization.
    ///
    /// Production initialization must be signed by the hardcoded Orbs treasury
    /// wallet. The relayer may pay rent, but it gains no authority. Later signer
    /// rotation is possible only through the explicit three-party rotation paths.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        claim_authority: Pubkey,
        fee_quote_authority: Pubkey,
    ) -> Result<()> {
        require!(claim_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(fee_quote_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(claim_authority != fee_quote_authority, OrbsError::AuthoritiesMustBeDistinct);
        require!(claim_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(claim_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);
        require!(claim_authority != ORBS_ADMIN_CREATOR, OrbsError::InvalidAuthority);
        require!(fee_quote_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(fee_quote_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);
        require!(fee_quote_authority != ORBS_ADMIN_CREATOR, OrbsError::InvalidAuthority);

        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        config.version = CURRENT_VERSION;
        config.bump = ctx.bumps.config;
        config.claim_authority = claim_authority;
        config.fee_quote_authority = fee_quote_authority;
        config.initialized_at = now;

        emit!(ProtocolInitialized {
            config: config.key(),
            claim_authority,
            fee_quote_authority,
            initialized_at: now,
        });

        Ok(())
    }

    /// Rotate the high-consequence claim authority without creating a unilateral
    /// admin path. Rotation requires signatures from the hardcoded treasury, the
    /// currently configured claim authority, AND the proposed new authority.
    pub fn rotate_claim_authority(ctx: Context<RotateClaimAuthority>) -> Result<()> {
        let new_authority = ctx.accounts.new_claim_authority.key();
        require!(new_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_ADMIN_CREATOR, OrbsError::InvalidAuthority);
        require!(
            new_authority != ctx.accounts.config.fee_quote_authority,
            OrbsError::AuthoritiesMustBeDistinct
        );
        let previous_authority = ctx.accounts.config.claim_authority;
        require!(new_authority != previous_authority, OrbsError::AuthorityUnchanged);
        ctx.accounts.config.claim_authority = new_authority;
        emit!(ClaimAuthorityRotated {
            config: ctx.accounts.config.key(),
            previous_authority,
            new_authority,
            rotated_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Rotate the low-custody fee quote signer using the same three-party proof.
    /// This key can authorize only new-creation economics; it never controls vaults.
    pub fn rotate_fee_quote_authority(ctx: Context<RotateFeeQuoteAuthority>) -> Result<()> {
        let new_authority = ctx.accounts.new_fee_quote_authority.key();
        require!(new_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_ADMIN_CREATOR, OrbsError::InvalidAuthority);
        require!(
            new_authority != ctx.accounts.config.claim_authority,
            OrbsError::AuthoritiesMustBeDistinct
        );
        let previous_authority = ctx.accounts.config.fee_quote_authority;
        require!(new_authority != previous_authority, OrbsError::AuthorityUnchanged);
        ctx.accounts.config.fee_quote_authority = new_authority;
        emit!(FeeQuoteAuthorityRotated {
            config: ctx.accounts.config.key(),
            previous_authority,
            new_authority,
            rotated_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Atomically creates one isolated Orb prize vault and funds:
    /// 1) the full advertised prize into the Orb-owned ATA; and
    /// 2) the separate $1.15-equivalent same-token fee into the canonical ATA
    ///    of the hardcoded Orbs treasury.
    ///
    /// Security boundary:
    /// - host signs only their own token debit;
    /// - payer only sponsors SOL/rent;
    /// - fee_quote_authority attests the off-chain USD quote and exact amounts;
    /// - claim authority is NOT involved and cannot move funds at creation.
    pub fn create_and_fund_orb(
        ctx: Context<CreateAndFundOrb>,
        args: CreateOrbArgs,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(args.orb_id != [0u8; 16], OrbsError::InvalidOrbId);
        require!(args.game_commitment != [0u8; 32], OrbsError::InvalidGameCommitment);
        require!(args.prize_amount > 0, OrbsError::InvalidPrizeAmount);
        require!(args.fee_amount > 0, OrbsError::InvalidFeeAmount);
        let fee_bps_numerator = (args.fee_amount as u128)
            .checked_mul(10_000)
            .ok_or(OrbsError::MathOverflow)?;
        let fee_bps_limit = (args.prize_amount as u128)
            .checked_mul(MAX_FEE_BPS_OF_PRIZE)
            .ok_or(OrbsError::MathOverflow)?;
        require!(fee_bps_numerator <= fee_bps_limit, OrbsError::ExcessiveFeeAmount);
        require!(
            args.prize_usd_micros >= MIN_PRIZE_USD_MICROS,
            OrbsError::PrizeBelowUsdMinimum
        );
        // A classic SPL mint with a freeze authority can freeze the Orb vault
        // after funding and prevent both winner payout and the permissionless
        // expiry refund. V1 therefore accepts only non-freezable classic SPL mints.
        require!(ctx.accounts.mint.freeze_authority.is_none(), OrbsError::FreezeAuthorityNotAllowed);
        let min_start = now
            .checked_add(MIN_START_LEAD_SECONDS)
            .ok_or(OrbsError::MathOverflow)?;
        let max_start = now
            .checked_add(MAX_START_DELAY_SECONDS)
            .ok_or(OrbsError::MathOverflow)?;
        require!(args.starts_at >= min_start && args.starts_at <= max_start, OrbsError::InvalidStartTime);
        require!(args.refund_after > args.starts_at, OrbsError::InvalidRefundTime);
        require!(args.quote_expires_at >= now, OrbsError::QuoteExpired);

        let quote_ttl = args
            .quote_expires_at
            .checked_sub(now)
            .ok_or(OrbsError::MathOverflow)?;
        require!(quote_ttl <= MAX_QUOTE_TTL_SECONDS, OrbsError::QuoteTooLong);

        let settlement_window = args
            .refund_after
            .checked_sub(args.starts_at)
            .ok_or(OrbsError::MathOverflow)?;
        require!(
            settlement_window == SETTLEMENT_WINDOW_SECONDS,
            OrbsError::InvalidSettlementWindow
        );

        let host_key = ctx.accounts.host.key();
        require!(host_key != ORBS_TREASURY, OrbsError::InvalidHost);
        require!(host_key != ORBS_RENT_RECEIVER, OrbsError::InvalidHost);
        require!(
            host_key != ctx.accounts.config.claim_authority,
            OrbsError::InvalidHost
        );
        require!(
            host_key != ctx.accounts.config.fee_quote_authority,
            OrbsError::InvalidHost
        );

        // Enforce the product's one-active-Orb rule on-chain, not merely in Redis.
        // The persistent policy PDA is reusable after expiry, so an unclaimed old
        // Orb can never strand the creator behind a stale lock. The designated
        // test creator is exempt from only this concurrency rule.
        let orb_key = ctx.accounts.orb.key();
        let host_policy = &mut ctx.accounts.host_policy;
        if host_key != ORBS_ADMIN_CREATOR && host_policy.version != 0 {
            require!(host_policy.host == host_key, OrbsError::InvalidHostPolicy);
            require!(now >= host_policy.active_until, OrbsError::ActiveOrbExists);
        }
        host_policy.version = CURRENT_VERSION;
        host_policy.bump = ctx.bumps.host_policy;
        host_policy.host = host_key;
        host_policy.active_orb = orb_key;
        host_policy.active_until = args.refund_after;

        let total_debit = args
            .prize_amount
            .checked_add(args.fee_amount)
            .ok_or(OrbsError::MathOverflow)?;
        require!(
            ctx.accounts.host_token_account.amount >= total_debit,
            OrbsError::InsufficientTokenBalance
        );

        let prize_vault_pre = ctx.accounts.prize_vault.amount;
        let treasury_pre = ctx.accounts.treasury_token_account.amount;

        {
            let orb = &mut ctx.accounts.orb;
            orb.version = CURRENT_VERSION;
            orb.bump = ctx.bumps.orb;
            orb.orb_id = args.orb_id;
            orb.host = host_key;
            orb.mint = ctx.accounts.mint.key();
            orb.prize_amount = args.prize_amount;
            orb.fee_amount = args.fee_amount;
            orb.prize_usd_micros = args.prize_usd_micros;
            orb.starts_at = args.starts_at;
            orb.refund_after = args.refund_after;
            orb.game_commitment = args.game_commitment;
            orb.created_at = now;
        }

        // Full advertised prize -> isolated Orb vault.
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.host_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.prize_vault.to_account_info(),
                    authority: ctx.accounts.host.to_account_info(),
                },
            ),
            args.prize_amount,
            ctx.accounts.mint.decimals,
        )?;

        // Separate same-token $1.15 quote -> hardcoded treasury's canonical ATA.
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.host_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.host.to_account_info(),
                },
            ),
            args.fee_amount,
            ctx.accounts.mint.decimals,
        )?;

        // Classic SPL transfers are exact. Assert the host-funded delta rather
        // than requiring an initially empty ATA: anyone can permissionlessly
        // pre-create an ATA or donate same-mint dust, and neither should be able
        // to grief an otherwise valid Orb. Any unsolicited tokens remain trapped
        // in the same canonical vault and are paid with the prize/refund.
        ctx.accounts.prize_vault.reload()?;
        let prize_delta = ctx
            .accounts
            .prize_vault
            .amount
            .checked_sub(prize_vault_pre)
            .ok_or(OrbsError::MathOverflow)?;
        require!(prize_delta == args.prize_amount, OrbsError::PrizeVaultInvariantFailed);

        ctx.accounts.treasury_token_account.reload()?;
        let treasury_delta = ctx
            .accounts
            .treasury_token_account
            .amount
            .checked_sub(treasury_pre)
            .ok_or(OrbsError::MathOverflow)?;
        require!(
            treasury_delta == args.fee_amount,
            OrbsError::TreasuryFeeInvariantFailed
        );

        emit!(OrbCreated {
            orb: ctx.accounts.orb.key(),
            orb_id: args.orb_id,
            host: host_key,
            mint: ctx.accounts.mint.key(),
            prize_amount: args.prize_amount,
            prize_usd_micros: args.prize_usd_micros,
            fee_amount: args.fee_amount,
            fee_usd_micros: ORBS_FEE_USD_MICROS,
            starts_at: args.starts_at,
            refund_after: args.refund_after,
            game_commitment: args.game_commitment,
        });

        Ok(())
    }

    /// Winner-initiated claim flow.
    ///
    /// The website's "Claim your prize" button must submit a transaction signed by:
    /// - the connected winner wallet; and
    /// - the configured official Orbs claim authority (intended to be Turnkey/HSM).
    ///
    /// The relayer/payer may sponsor SOL and a missing winner ATA, but it is never
    /// accepted as winner evidence and is never used as an SPL transfer authority.
    pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let orb = &ctx.accounts.orb;

        require!(now >= orb.starts_at, OrbsError::GameNotStarted);
        require!(now < orb.refund_after, OrbsError::SettlementWindowExpired);
        require!(args.result_hash != [0u8; 32], OrbsError::InvalidResultHash);
        require!(args.completed_at >= orb.starts_at, OrbsError::InvalidCompletionTime);
        require!(args.completed_at <= now, OrbsError::InvalidCompletionTime);
        require!(args.completed_at < orb.refund_after, OrbsError::InvalidCompletionTime);

        let winner_key = ctx.accounts.winner.key();
        require!(winner_key != Pubkey::default(), OrbsError::InvalidWinner);
        require!(winner_key != orb.host, OrbsError::HostCannotWinOwnOrb);
        require!(winner_key != ORBS_TREASURY, OrbsError::InvalidWinner);
        require!(winner_key != ORBS_RENT_RECEIVER, OrbsError::InvalidWinner);
        require!(
            winner_key != ctx.accounts.config.claim_authority,
            OrbsError::InvalidWinner
        );
        require!(
            winner_key != ctx.accounts.config.fee_quote_authority,
            OrbsError::InvalidWinner
        );

        let vault_amount = ctx.accounts.prize_vault.amount;
        require!(
            vault_amount >= orb.prize_amount,
            OrbsError::PrizeVaultInvariantFailed
        );
        require!(vault_amount > 0, OrbsError::EmptyPrizeVault);

        let host = orb.host;
        let orb_id = orb.orb_id;
        let advertised_prize = orb.prize_amount;
        let bump = [orb.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            ORB_SEED,
            host.as_ref(),
            orb_id.as_ref(),
            &bump,
        ]];

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            vault_amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.prize_vault.reload()?;
        require!(ctx.accounts.prize_vault.amount == 0, OrbsError::VaultDidNotDrain);

        // Close temporary SPL vault and reclaim its lamports to the fixed Orbs
        // rent receiver. The receiver never becomes token authority.
        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                CloseAccount {
                    account: ctx.accounts.prize_vault.to_account_info(),
                    destination: ctx.accounts.rent_receiver.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
        )?;

        emit!(OrbClaimed {
            orb: ctx.accounts.orb.key(),
            orb_id,
            host,
            winner: winner_key,
            mint: ctx.accounts.mint.key(),
            advertised_prize_amount: advertised_prize,
            paid_amount: vault_amount,
            game_commitment: orb.game_commitment,
            result_hash: args.result_hash,
            completed_at: args.completed_at,
            claimed_at: now,
        });

        // Anchor closes `orb` after successful handler exit, making the claim
        // naturally one-shot and replay resistant.
        Ok(())
    }

    /// Permissionless safety valve. At/after `refund_after`, anyone may pay for
    /// the transaction. The program fixes both SPL and rent destinations:
    /// - all remaining prize tokens -> original host's canonical ATA
    /// - temporary-account lamports -> hardcoded Orbs rent receiver
    ///
    /// Orbs/Turnkey/relayer infrastructure is not required for this path.
    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let orb = &ctx.accounts.orb;

        require!(now >= orb.refund_after, OrbsError::RefundNotAvailable);

        let vault_amount = ctx.accounts.prize_vault.amount;
        require!(vault_amount > 0, OrbsError::EmptyPrizeVault);

        let host = orb.host;
        let orb_id = orb.orb_id;
        let bump = [orb.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            ORB_SEED,
            host.as_ref(),
            orb_id.as_ref(),
            &bump,
        ]];

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.host_token_account.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            vault_amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.prize_vault.reload()?;
        require!(ctx.accounts.prize_vault.amount == 0, OrbsError::VaultDidNotDrain);

        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                CloseAccount {
                    account: ctx.accounts.prize_vault.to_account_info(),
                    destination: ctx.accounts.rent_receiver.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
        )?;

        emit!(OrbRefunded {
            orb: ctx.accounts.orb.key(),
            orb_id,
            host,
            mint: ctx.accounts.mint.key(),
            refunded_amount: vault_amount,
            refunded_at: now,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Instruction arguments
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct CreateOrbArgs {
    pub orb_id: [u8; 16],
    pub prize_amount: u64,
    /// Signed quote assertion. The program enforces >= $5.00 but the quote
    /// authority is responsible for proving this corresponds to `prize_amount`.
    pub prize_usd_micros: u64,
    /// Raw token units corresponding to the immutable $1.15 Orbs fee policy.
    pub fee_amount: u64,
    pub starts_at: i64,
    pub refund_after: i64,
    pub quote_expires_at: i64,
    pub game_commitment: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClaimPrizeArgs {
    /// Hash of the canonical server-side result record/telemetry package.
    /// This is audit evidence, not a secret and not payout authority.
    pub result_hash: [u8; 32],
    /// Server-adjudicated completion timestamp; bounded by on-chain start/refund.
    pub completed_at: i64,
}

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    /// Only the hardcoded treasury wallet may initialize the protocol authorities.
    #[account(address = ORBS_TREASURY @ OrbsError::InvalidInitializer)]
    pub initializer: Signer<'info>,

    /// Any signer may sponsor this one-time config rent. Production uses the Orbs relayer.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ProtocolConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RotateClaimAuthority<'info> {
    #[account(address = ORBS_TREASURY @ OrbsError::InvalidInitializer)]
    pub treasury: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    #[account(address = config.claim_authority @ OrbsError::UnauthorizedClaimAuthority)]
    pub current_claim_authority: Signer<'info>,

    pub new_claim_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RotateFeeQuoteAuthority<'info> {
    #[account(address = ORBS_TREASURY @ OrbsError::InvalidInitializer)]
    pub treasury: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    #[account(address = config.fee_quote_authority @ OrbsError::UnauthorizedFeeQuoteAuthority)]
    pub current_fee_quote_authority: Signer<'info>,

    pub new_fee_quote_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: CreateOrbArgs)]
pub struct CreateAndFundOrb<'info> {
    /// Host authorizes transfers out of only their canonical SPL ATA.
    #[account(mut)]
    pub host: Signer<'info>,

    /// Fixed production rent/fee sponsor. Keeping the creator-side payer fixed
    /// ensures the account rent later reclaimed to ORBS_RENT_RECEIVER was
    /// originally provided by that same sponsor.
    #[account(mut, address = ORBS_RENT_RECEIVER @ OrbsError::InvalidRentPayer)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// Low-consequence quote signer. It attests that raw prize/fee amounts match
    /// the $5 minimum and $1.15 fee policy. It has zero settlement/custody power.
    #[account(address = config.fee_quote_authority @ OrbsError::UnauthorizedFeeQuoteAuthority)]
    pub fee_quote_authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Orb::SPACE,
        seeds = [ORB_SEED, host.key().as_ref(), args.orb_id.as_ref()],
        bump
    )]
    pub orb: Account<'info, Orb>,

    /// Persistent per-host concurrency policy. It is reused after expiry rather
    /// than closed, which prevents stale custody accounts from blocking creation.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + HostPolicy::SPACE,
        seeds = [HOST_POLICY_SEED, host.key().as_ref()],
        bump
    )]
    pub host_policy: Account<'info, HostPolicy>,

    /// Classic SPL Token mint only. Together with Program<Token>, this excludes
    /// Token-2022 from the V1 instruction path.
    pub mint: Account<'info, Mint>,

    /// Canonical host ATA only: no arbitrary source or delegate custody path.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = host,
        associated_token::token_program = token_program
    )]
    pub host_token_account: Account<'info, TokenAccount>,

    /// One isolated prize ATA per Orb/mint, authority = Orb PDA.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = orb,
        associated_token::token_program = token_program
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    /// CHECK: hardcoded wallet; never signs and is only ATA authority for fee custody.
    #[account(address = ORBS_TREASURY @ OrbsError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    /// Canonical treasury ATA for this mint. Payer sponsors it once if missing.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    /// SOL/rent sponsor only. It does not decide the winner. Production uses the
    /// Orbs relayer and keeps its SOL balance intentionally small.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: fixed recipient of reclaimed lamports only. Never an SPL authority.
    #[account(mut, address = ORBS_RENT_RECEIVER @ OrbsError::InvalidRentReceiver)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// Official Turnkey/HSM-backed claim signer fixed at protocol initialization.
    #[account(address = config.claim_authority @ OrbsError::UnauthorizedClaimAuthority)]
    pub claim_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ORB_SEED, orb.host.as_ref(), orb.orb_id.as_ref()],
        bump = orb.bump,
        close = rent_receiver
    )]
    pub orb: Account<'info, Orb>,

    #[account(address = orb.mint @ OrbsError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = orb,
        associated_token::token_program = token_program
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    /// The connected winner must personally sign the Claim transaction.
    #[account(mut)]
    pub winner: Signer<'info>,

    /// Canonical winner ATA. Payer creates it atomically if the winner has never
    /// held this mint. The destination cannot be substituted by the client.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = winner,
        associated_token::token_program = token_program
    )]
    pub winner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    /// Anyone may sponsor an expired refund. Orbs infrastructure is optional.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: fixed recipient of reclaimed lamports only. Caller cannot redirect rent.
    #[account(mut, address = ORBS_RENT_RECEIVER @ OrbsError::InvalidRentReceiver)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [ORB_SEED, orb.host.as_ref(), orb.orb_id.as_ref()],
        bump = orb.bump,
        close = rent_receiver
    )]
    pub orb: Account<'info, Orb>,

    #[account(address = orb.mint @ OrbsError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = orb,
        associated_token::token_program = token_program
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    /// CHECK: fixed by Orb state; caller cannot choose another refund owner.
    #[account(address = orb.host @ OrbsError::HostMismatch)]
    pub host: UncheckedAccount<'info>,

    /// Canonical host ATA. If host closed it while the Orb was live, the refund
    /// sponsor can recreate it; tokens still go only to the original host.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = host,
        associated_token::token_program = token_program
    )]
    pub host_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

/// Global V1 authority binding. Treasury and rent destinations are hardcoded and
/// immutable; signer rotation requires treasury + current + new authority proof.
/// There are no pause, withdrawal, or arbitrary destination instructions.
#[account]
pub struct ProtocolConfig {
    pub version: u8,
    pub bump: u8,
    pub claim_authority: Pubkey,
    pub fee_quote_authority: Pubkey,
    pub initialized_at: i64,
}

impl ProtocolConfig {
    pub const SPACE: usize =
        1 + // version
        1 + // bump
        32 + // claim_authority
        32 + // fee_quote_authority
        8; // initialized_at
}

/// Persistent creator policy enforcing at most one live Orb per host. The
/// account intentionally survives settlement so a creator never needs another
/// rent allocation and an expired-but-unrefunded Orb cannot leave a stale lock.
#[account]
pub struct HostPolicy {
    pub version: u8,
    pub bump: u8,
    pub host: Pubkey,
    pub active_orb: Pubkey,
    pub active_until: i64,
}

impl HostPolicy {
    pub const SPACE: usize =
        1 + // version
        1 + // bump
        32 + // host
        32 + // active_orb
        8; // active_until
}

/// A funded Orb exists only while custody is live. On claim/refund this account
/// and its isolated prize ATA are both closed.
#[account]
pub struct Orb {
    pub version: u8,
    pub bump: u8,
    pub orb_id: [u8; 16],
    pub host: Pubkey,
    pub mint: Pubkey,
    pub prize_amount: u64,
    pub fee_amount: u64,
    pub prize_usd_micros: u64,
    pub starts_at: i64,
    pub refund_after: i64,
    pub game_commitment: [u8; 32],
    pub created_at: i64,
}

impl Orb {
    pub const SPACE: usize =
        1 + // version
        1 + // bump
        16 + // orb_id
        32 + // host
        32 + // mint
        8 + // prize_amount
        8 + // fee_amount
        8 + // prize_usd_micros
        8 + // starts_at
        8 + // refund_after
        32 + // game_commitment
        8; // created_at
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

#[event]
pub struct ProtocolInitialized {
    pub config: Pubkey,
    pub claim_authority: Pubkey,
    pub fee_quote_authority: Pubkey,
    pub initialized_at: i64,
}

#[event]
pub struct ClaimAuthorityRotated {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
    pub rotated_at: i64,
}

#[event]
pub struct FeeQuoteAuthorityRotated {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
    pub rotated_at: i64,
}

#[event]
pub struct OrbCreated {
    pub orb: Pubkey,
    pub orb_id: [u8; 16],
    pub host: Pubkey,
    pub mint: Pubkey,
    pub prize_amount: u64,
    pub prize_usd_micros: u64,
    pub fee_amount: u64,
    pub fee_usd_micros: u64,
    pub starts_at: i64,
    pub refund_after: i64,
    pub game_commitment: [u8; 32],
}

#[event]
pub struct OrbClaimed {
    pub orb: Pubkey,
    pub orb_id: [u8; 16],
    pub host: Pubkey,
    pub winner: Pubkey,
    pub mint: Pubkey,
    pub advertised_prize_amount: u64,
    pub paid_amount: u64,
    pub game_commitment: [u8; 32],
    pub result_hash: [u8; 32],
    pub completed_at: i64,
    pub claimed_at: i64,
}

#[event]
pub struct OrbRefunded {
    pub orb: Pubkey,
    pub orb_id: [u8; 16],
    pub host: Pubkey,
    pub mint: Pubkey,
    pub refunded_amount: u64,
    pub refunded_at: i64,
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

#[error_code]
pub enum OrbsError {
    #[msg("Only the hardcoded Orbs treasury may initialize protocol authorities")]
    InvalidInitializer,
    #[msg("Invalid protocol authority")]
    InvalidAuthority,
    #[msg("Claim and fee quote authorities must be distinct")]
    AuthoritiesMustBeDistinct,
    #[msg("New authority must differ from the current authority")]
    AuthorityUnchanged,
    #[msg("Fee quote authority signature is missing or incorrect")]
    UnauthorizedFeeQuoteAuthority,
    #[msg("Claim authority signature is missing or incorrect")]
    UnauthorizedClaimAuthority,
    #[msg("Orb id cannot be all zeroes")]
    InvalidOrbId,
    #[msg("Game commitment cannot be all zeroes")]
    InvalidGameCommitment,
    #[msg("Prize amount must be greater than zero")]
    InvalidPrizeAmount,
    #[msg("Protocol fee amount must be greater than zero")]
    InvalidFeeAmount,
    #[msg("Protocol fee is too large relative to the advertised prize")]
    ExcessiveFeeAmount,
    #[msg("Classic SPL mints with a freeze authority are not supported in Orbs V1")]
    FreezeAuthorityNotAllowed,
    #[msg("Quoted prize is below the $5.00 V1 minimum")]
    PrizeBelowUsdMinimum,
    #[msg("Start time must be in the future")]
    InvalidStartTime,
    #[msg("Refund time must be after the start time")]
    InvalidRefundTime,
    #[msg("Fee quote has expired")]
    QuoteExpired,
    #[msg("Fee quote lifetime exceeds the allowed maximum")]
    QuoteTooLong,
    #[msg("Refund time must be exactly the fixed V1 settlement window after start")]
    InvalidSettlementWindow,
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("Invalid host")]
    InvalidHost,
    #[msg("Host token account does not contain prize plus fee")]
    InsufficientTokenBalance,
    #[msg("Prize vault failed its funding/balance invariant")]
    PrizeVaultInvariantFailed,
    #[msg("Treasury fee transfer failed its exact-delta invariant")]
    TreasuryFeeInvariantFailed,
    #[msg("Hardcoded treasury address mismatch")]
    InvalidTreasury,
    #[msg("Hardcoded rent receiver address mismatch")]
    InvalidRentReceiver,
    #[msg("Creator-side SOL/rent payer must be the hardcoded Orbs relayer")]
    InvalidRentPayer,
    #[msg("This creator already has an Orb that has not expired")]
    ActiveOrbExists,
    #[msg("Creator policy PDA does not match the expected host")]
    InvalidHostPolicy,
    #[msg("Mint does not match Orb state")]
    MintMismatch,
    #[msg("Original host does not match Orb state")]
    HostMismatch,
    #[msg("Game has not started according to Solana's on-chain clock")]
    GameNotStarted,
    #[msg("Settlement window has expired")]
    SettlementWindowExpired,
    #[msg("Refund is not available yet")]
    RefundNotAvailable,
    #[msg("Invalid winner")]
    InvalidWinner,
    #[msg("The host cannot win their own Orb")]
    HostCannotWinOwnOrb,
    #[msg("Result hash cannot be all zeroes")]
    InvalidResultHash,
    #[msg("Completion timestamp is outside the permitted game/claim window")]
    InvalidCompletionTime,
    #[msg("Prize vault is empty")]
    EmptyPrizeVault,
    #[msg("Prize vault did not drain to zero")]
    VaultDidNotDrain,
}
