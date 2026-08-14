#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns");

/// Hardcoded production treasury identity. It never has vault authority and does
/// not control protocol configuration; config authority follows the program's actual
/// on-chain upgrade authority.
pub const ORBS_TREASURY: Pubkey =
    pubkey!("5mEqxr6McBRL5DGE9dJ2Td3viwhAmRpe4V7pqGTPMtvr");

/// Hardcoded production relayer/rent receiver. It funds Orb/vault rent at creation
/// and receives that same temporary-account rent back after claim/refund.
/// It is never an SPL-token authority.
pub const ORBS_RENT_RECEIVER: Pubkey =
    pubkey!("GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN");

pub const CONFIG_SEED: &[u8] = b"config";
pub const ORB_SEED: &[u8] = b"orb";

#[program]
pub mod orbs_protocol {
    use super::*;

    /// One-time setup. Only the program's current on-chain upgrade authority may
    /// create config and install the Turnkey/HSM-backed claim key.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        claim_authority: Pubkey,
    ) -> Result<()> {
        require!(claim_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(claim_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(claim_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);

        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.claim_authority = claim_authority;
        Ok(())
    }

    /// Only the program's current on-chain upgrade authority may rotate the
    /// Turnkey/HSM-backed claim key. No unrelated treasury, relayer, or old claim
    /// key signature is required because the upgrade authority is already the
    /// program's ultimate mutable root of trust.
    pub fn rotate_claim_authority(
        ctx: Context<RotateClaimAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        require!(new_authority != Pubkey::default(), OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_TREASURY, OrbsError::InvalidAuthority);
        require!(new_authority != ORBS_RENT_RECEIVER, OrbsError::InvalidAuthority);
        require!(
            new_authority != ctx.accounts.config.claim_authority,
            OrbsError::AuthorityUnchanged
        );

        ctx.accounts.config.claim_authority = new_authority;
        Ok(())
    }

    /// Minimal custody entry.
    ///
    /// Product rules such as USD minimums, the $1.15 fee, quote TTL, one-active-Orb
    /// policy, and launch-window policy are intentionally enforced by the Orbs
    /// server/transaction firewall rather than by this custody kernel.
    ///
    /// This instruction only proves:
    /// - the host signed;
    /// - the source is the host's canonical classic-SPL ATA;
    /// - the prize enters the canonical ATA owned by this Orb PDA;
    /// - start/refund ordering is sane;
    /// - the fixed Orbs relayer paid the temporary account rent.
    pub fn fund_orb(ctx: Context<FundOrb>, args: FundOrbArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(args.orb_id != [0u8; 16], OrbsError::InvalidOrbId);
        require!(args.prize_amount > 0, OrbsError::InvalidPrizeAmount);
        require!(args.starts_at > now, OrbsError::InvalidStartTime);
        require!(args.refund_after > args.starts_at, OrbsError::InvalidRefundTime);

        let vault_before = ctx.accounts.prize_vault.amount;

        let orb = &mut ctx.accounts.orb;
        orb.bump = ctx.bumps.orb;
        orb.orb_id = args.orb_id;
        orb.host = ctx.accounts.host.key();
        orb.mint = ctx.accounts.mint.key();
        orb.prize_amount = args.prize_amount;
        orb.starts_at = args.starts_at;
        orb.refund_after = args.refund_after;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
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

        // Permissionless ATA creation/dust must not be able to spoof the amount
        // actually contributed by this funding transaction.
        ctx.accounts.prize_vault.reload()?;
        let funded = ctx
            .accounts
            .prize_vault
            .amount
            .checked_sub(vault_before)
            .ok_or(OrbsError::MathOverflow)?;
        require!(funded == args.prize_amount, OrbsError::FundingInvariantFailed);

        emit!(OrbFunded {
            orb: ctx.accounts.orb.key(),
            host: ctx.accounts.host.key(),
            mint: ctx.accounts.mint.key(),
            prize_amount: args.prize_amount,
            starts_at: args.starts_at,
            refund_after: args.refund_after,
        });

        Ok(())
    }

    /// Winner settlement. The server decides who won; Turnkey attests that decision.
    /// The winner must also sign, and Anchor fixes the destination to that winner's
    /// canonical ATA for the Orb mint.
    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let orb = &ctx.accounts.orb;

        require!(now >= orb.starts_at, OrbsError::GameNotStarted);
        require!(now < orb.refund_after, OrbsError::SettlementWindowExpired);

        // Preserve true two-party settlement: the Turnkey claim key must never be
        // able to satisfy both the authorization and winner roles with one signature.
        let winner = ctx.accounts.winner.key();
        require!(
            winner != ctx.accounts.config.claim_authority,
            OrbsError::InvalidWinner
        );
        require!(winner != orb.host, OrbsError::InvalidWinner);
        require!(winner != ORBS_TREASURY, OrbsError::InvalidWinner);
        require!(winner != ORBS_RENT_RECEIVER, OrbsError::InvalidWinner);

        let amount = ctx.accounts.prize_vault.amount;
        require!(amount > 0, OrbsError::EmptyPrizeVault);
        require!(amount >= orb.prize_amount, OrbsError::FundingInvariantFailed);

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
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.prize_vault.reload()?;
        require!(ctx.accounts.prize_vault.amount == 0, OrbsError::VaultDidNotDrain);

        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
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
            winner: ctx.accounts.winner.key(),
            mint: ctx.accounts.mint.key(),
            amount,
        });

        // `orb` is closed automatically by the account constraint after success,
        // making settlement one-shot and returning its rent to the relayer.
        Ok(())
    }

    /// Permissionless liveness escape hatch. Once expired, anybody may submit the
    /// transaction, but Anchor fixes the token destination to the original host's
    /// canonical ATA. Orbs/Turnkey/server availability is not required.
    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let orb = &ctx.accounts.orb;

        require!(now >= orb.refund_after, OrbsError::RefundNotAvailable);

        let amount = ctx.accounts.prize_vault.amount;
        require!(amount > 0, OrbsError::EmptyPrizeVault);

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
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.host_token_account.to_account_info(),
                    authority: ctx.accounts.orb.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.prize_vault.reload()?;
        require!(ctx.accounts.prize_vault.amount == 0, OrbsError::VaultDidNotDrain);

        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
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
            host,
            mint: ctx.accounts.mint.key(),
            amount,
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct FundOrbArgs {
    pub orb_id: [u8; 16],
    pub prize_amount: u64,
    pub starts_at: i64,
    pub refund_after: i64,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    /// The only signer allowed to initialize config is the program's actual current
    /// upgrade authority as recorded by the upgradeable loader's ProgramData account.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ OrbsError::InvalidProgramData
    )]
    pub program: Program<'info, crate::program::OrbsProtocol>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ OrbsError::UnauthorizedUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RotateClaimAuthority<'info> {
    /// Must be the program's actual current upgrade authority, verified against the
    /// loader-owned ProgramData account rather than against a hardcoded address.
    pub authority: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ OrbsError::InvalidProgramData
    )]
    pub program: Program<'info, crate::program::OrbsProtocol>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ OrbsError::UnauthorizedUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(args: FundOrbArgs)]
pub struct FundOrb<'info> {
    #[account(mut)]
    pub host: Signer<'info>,

    /// Fixed relayer pays Orb/vault rent and receives it back at close.
    #[account(mut, address = ORBS_RENT_RECEIVER @ OrbsError::InvalidRentPayer)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Orb::SPACE,
        seeds = [ORB_SEED, host.key().as_ref(), args.orb_id.as_ref()],
        bump
    )]
    pub orb: Account<'info, Orb>,

    /// `Program<Token>` + typed Mint/TokenAccount intentionally excludes Token-2022.
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = host,
        associated_token::token_program = token_program
    )]
    pub host_token_account: Account<'info, TokenAccount>,

    /// `init_if_needed` prevents a third party from griefing a predictable ATA by
    /// pre-creating it. Any donated dust remains locked with the same Orb.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = orb,
        associated_token::token_program = token_program
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    /// Relayer normally pays transaction/ATA rent. It has no token authority.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is safe as unchecked because its address is constrained
    /// exactly to the hardcoded ORBS_RENT_RECEIVER. It receives reclaimed lamports
    /// only and is never used as SPL-token authority.
    #[account(mut, address = ORBS_RENT_RECEIVER @ OrbsError::InvalidRentReceiver)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

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

    pub winner: Signer<'info>,

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
    /// Anyone may sponsor an expired refund.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is safe as unchecked because its address is constrained
    /// exactly to the hardcoded ORBS_RENT_RECEIVER. It receives reclaimed lamports
    /// only and is never used as SPL-token authority.
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

    /// CHECK: This account is safe as unchecked because its address is constrained
    /// exactly to orb.host. It cannot be substituted by the refund caller and is
    /// used only as the authority seed for the canonical host ATA.
    #[account(address = orb.host @ OrbsError::HostMismatch)]
    pub host: UncheckedAccount<'info>,

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

#[account]
pub struct ProtocolConfig {
    pub bump: u8,
    pub claim_authority: Pubkey,
}

impl ProtocolConfig {
    pub const SPACE: usize = 1 + 32;
}

#[account]
pub struct Orb {
    pub bump: u8,
    pub orb_id: [u8; 16],
    pub host: Pubkey,
    pub mint: Pubkey,
    pub prize_amount: u64,
    pub starts_at: i64,
    pub refund_after: i64,
}

impl Orb {
    pub const SPACE: usize =
        1 +  // bump
        16 + // orb_id
        32 + // host
        32 + // mint
        8 +  // prize_amount
        8 +  // starts_at
        8;   // refund_after
}

#[event]
pub struct OrbFunded {
    pub orb: Pubkey,
    pub host: Pubkey,
    pub mint: Pubkey,
    pub prize_amount: u64,
    pub starts_at: i64,
    pub refund_after: i64,
}

#[event]
pub struct OrbClaimed {
    pub orb: Pubkey,
    pub winner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct OrbRefunded {
    pub orb: Pubkey,
    pub host: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum OrbsError {
    #[msg("ProgramData account does not belong to this Orbs program")]
    InvalidProgramData,
    #[msg("Only the program's current on-chain upgrade authority may modify config")]
    UnauthorizedUpgradeAuthority,
    #[msg("Invalid claim authority")]
    InvalidAuthority,
    #[msg("New claim authority must differ from the current authority")]
    AuthorityUnchanged,
    #[msg("Claim authority signature is missing or incorrect")]
    UnauthorizedClaimAuthority,
    #[msg("Orb id cannot be all zeroes")]
    InvalidOrbId,
    #[msg("Prize amount must be greater than zero")]
    InvalidPrizeAmount,
    #[msg("Start time must be in the future")]
    InvalidStartTime,
    #[msg("Refund time must be after the start time")]
    InvalidRefundTime,
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("Funding transfer did not increase the Orb vault by the advertised prize")]
    FundingInvariantFailed,
    #[msg("Hardcoded relayer/rent receiver mismatch")]
    InvalidRentReceiver,
    #[msg("Creator-side rent payer must be the hardcoded Orbs relayer")]
    InvalidRentPayer,
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
    #[msg("Winner cannot be the host or a protocol authority/system wallet")]
    InvalidWinner,
    #[msg("Prize vault is empty")]
    EmptyPrizeVault,
    #[msg("Prize vault did not drain to zero")]
    VaultDidNotDrain,
}
