use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::LendingPool;

pub fn handler(
    ctx: Context<InitializePool>,
    interest_rate_bps: u16,
    liquidation_bonus_bps: u16,
    max_ltv_bps: u16,
    liquidation_threshold_bps: u16,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.total_deposits = 0;
    pool.total_borrowed = 0;
    pool.interest_rate_bps = interest_rate_bps;
    pool.liquidation_bonus_bps = liquidation_bonus_bps;
    pool.max_ltv_bps = max_ltv_bps;
    pool.liquidation_threshold_bps = liquidation_threshold_bps;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = LendingPool::LEN,
        seeds = [b"pool", usdc_mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
