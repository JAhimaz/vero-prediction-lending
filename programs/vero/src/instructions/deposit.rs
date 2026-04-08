use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::{LendingPool, LenderPosition};

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    // Transfer USDC from lender to pool vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.lender_usdc.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.lender.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, 6)?;

    // Update pool state
    let pool = &mut ctx.accounts.pool;
    pool.total_deposits = pool.total_deposits.checked_add(amount).unwrap();

    // Update lender position
    let position = &mut ctx.accounts.lender_position;
    position.owner = ctx.accounts.lender.key();
    position.pool = pool.key();
    position.deposited_amount = position.deposited_amount.checked_add(amount).unwrap();
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
        seeds = [b"pool", pool.usdc_mint.as_ref()],
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
    pub lender_usdc: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
