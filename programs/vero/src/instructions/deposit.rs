use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::{LendingPool, LenderPosition};

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let fee_bps = ctx.accounts.pool.deposit_fee_bps;
    let fee = (amount as u128 * fee_bps as u128 / 10000) as u64;
    let net_amount = amount.saturating_sub(fee);

    // Transfer full amount from lender to pool vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.lender_usdc.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.lender.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, 6)?;

    // Transfer fee from vault to treasury (PDA signer)
    if fee > 0 {
        let pool = &ctx.accounts.pool;
        let usdc_mint_key = pool.usdc_mint;
        let market_mint_key = pool.market_mint;
        let pool_seeds = &[b"pool".as_ref(), usdc_mint_key.as_ref(), market_mint_key.as_ref(), &[pool.bump]];
        let signer_seeds = &[&pool_seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(), cpi_accounts, signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, fee, 6)?;
    }

    // Calculate shares: if first deposit, 1:1; otherwise proportional
    let pool = &mut ctx.accounts.pool;
    let new_shares = if pool.total_deposit_shares == 0 || pool.total_deposits == 0 {
        net_amount
    } else {
        (net_amount as u128)
            .checked_mul(pool.total_deposit_shares as u128)
            .unwrap()
            .checked_div(pool.total_deposits as u128)
            .unwrap() as u64
    };

    // Update pool state
    pool.total_deposits = pool.total_deposits.checked_add(net_amount).unwrap();
    pool.total_deposit_shares = pool.total_deposit_shares.checked_add(new_shares).unwrap();
    pool.total_fees_collected = pool.total_fees_collected.checked_add(fee).unwrap();

    // Update lender position
    let position = &mut ctx.accounts.lender_position;
    position.owner = ctx.accounts.lender.key();
    position.pool = pool.key();
    position.shares = position.shares.checked_add(new_shares).unwrap();
    position.last_update_ts = Clock::get()?.unix_timestamp;
    position.bump = ctx.bumps.lender_position;

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.usdc_mint.as_ref(), pool.market_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        init_if_needed,
        payer = lender,
        space = LenderPosition::LEN,
        seeds = [b"lender", pool.key().as_ref(), lender.key().as_ref()],
        bump,
    )]
    pub lender_position: Account<'info, LenderPosition>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = lender_usdc.mint == pool.usdc_mint,
        constraint = lender_usdc.owner == lender.key(),
    )]
    pub lender_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Treasury USDC token account that receives protocol fees
    #[account(
        mut,
        constraint = treasury_usdc.owner == pool.treasury,
        constraint = treasury_usdc.mint == pool.usdc_mint,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
