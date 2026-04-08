use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::VeroError;
use crate::state::{LendingPool, LenderPosition};

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let position = &ctx.accounts.lender_position;
    require!(amount <= position.deposited_amount, VeroError::InsufficientBalance);

    let pool = &ctx.accounts.pool;
    require!(amount <= pool.available_liquidity(), VeroError::InsufficientPoolLiquidity);

    // Transfer USDC from vault to lender (PDA signer)
    let usdc_mint_key = pool.usdc_mint;
    let pool_seeds = &[
        b"pool".as_ref(),
        usdc_mint_key.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.lender_usdc.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, 6)?;

    // Update state
    let pool = &mut ctx.accounts.pool;
    pool.total_deposits = pool.total_deposits.checked_sub(amount).unwrap();

    let position = &mut ctx.accounts.lender_position;
    position.deposited_amount = position.deposited_amount.checked_sub(amount).unwrap();
    position.last_update_ts = Clock::get()?.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.usdc_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        mut,
        seeds = [b"lender", pool.key().as_ref(), lender.key().as_ref()],
        bump = lender_position.bump,
        constraint = lender_position.owner == lender.key(),
    )]
    pub lender_position: Account<'info, LenderPosition>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = lender_usdc.mint == pool.usdc_mint,
        constraint = lender_usdc.owner == lender.key(),
    )]
    pub lender_usdc: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
