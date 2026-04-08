use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::VeroError;
use crate::state::{BorrowPosition, LendingPool, ProbabilityOracle};

/// Calculates the maximum borrow amount given collateral and probability.
/// collateral_value = collateral_amount * probability_bps / 10000
/// max_borrow = collateral_value * max_ltv_bps / 10000
fn max_borrow_amount(
    collateral_amount: u64,
    probability_bps: u16,
    max_ltv_bps: u16,
) -> Result<u64> {
    let collateral_value = (collateral_amount as u128)
        .checked_mul(probability_bps as u128)
        .ok_or(VeroError::MathOverflow)?
        / 10000u128;

    let max_borrow = collateral_value
        .checked_mul(max_ltv_bps as u128)
        .ok_or(VeroError::MathOverflow)?
        / 10000u128;

    Ok(max_borrow as u64)
}

pub fn handler(
    ctx: Context<Borrow>,
    collateral_amount: u64,
    borrow_amount: u64,
    resolution_ts: i64,
) -> Result<()> {
    require!(collateral_amount > 0, VeroError::ZeroCollateral);
    require!(borrow_amount > 0, VeroError::ZeroBorrow);

    let oracle = &ctx.accounts.oracle;
    require!(!oracle.resolved, VeroError::MarketResolved);

    let pool = &ctx.accounts.pool;
    require!(borrow_amount <= pool.available_liquidity(), VeroError::InsufficientPoolLiquidity);

    // Check LTV
    let max = max_borrow_amount(collateral_amount, oracle.probability_bps, pool.max_ltv_bps)?;
    require!(borrow_amount <= max, VeroError::ExceedsMaxLtv);

    // Transfer collateral tokens from borrower to collateral vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.borrower_collateral.to_account_info(),
        mint: ctx.accounts.collateral_mint.to_account_info(),
        to: ctx.accounts.collateral_vault.to_account_info(),
        authority: ctx.accounts.borrower.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, collateral_amount, 6)?;

    // Transfer USDC from pool vault to borrower
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
        to: ctx.accounts.borrower_usdc.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, borrow_amount, 6)?;

    // Update pool
    let pool = &mut ctx.accounts.pool;
    pool.total_borrowed = pool.total_borrowed.checked_add(borrow_amount).unwrap();

    // Initialize borrow position
    let position = &mut ctx.accounts.borrow_position;
    position.owner = ctx.accounts.borrower.key();
    position.pool = pool.key();
    position.collateral_mint = ctx.accounts.collateral_mint.key();
    position.collateral_amount = collateral_amount;
    position.borrowed_amount = borrow_amount;
    position.accrued_interest = 0;
    position.entry_probability_bps = oracle.probability_bps;
    let now = Clock::get()?.unix_timestamp;
    position.opened_at = now;
    position.last_accrual_ts = now;
    position.resolution_ts = resolution_ts;
    position.bump = ctx.bumps.borrow_position;
    position.collateral_vault_bump = ctx.bumps.collateral_vault;

    Ok(())
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.usdc_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"oracle", collateral_mint.key().as_ref()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, ProbabilityOracle>,

    #[account(
        init,
        payer = borrower,
        space = BorrowPosition::LEN,
        seeds = [b"borrow", pool.key().as_ref(), borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump,
    )]
    pub borrow_position: Account<'info, BorrowPosition>,

    #[account(
        init,
        payer = borrower,
        token::mint = collateral_mint,
        token::authority = pool,
        seeds = [b"collateral_vault", borrow_position.key().as_ref()],
        bump,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = borrower_collateral.mint == collateral_mint.key(),
        constraint = borrower_collateral.owner == borrower.key(),
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = borrower_usdc.mint == pool.usdc_mint,
        constraint = borrower_usdc.owner == borrower.key(),
    )]
    pub borrower_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
