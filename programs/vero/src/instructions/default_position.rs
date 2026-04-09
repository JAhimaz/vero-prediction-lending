use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::error::VeroError;
use crate::state::{BorrowPosition, LendingPool, ProbabilityOracle};

/// 48 hours in seconds.
const GRACE_PERIOD_SECS: i64 = 48 * 60 * 60;

pub fn handler(ctx: Context<DefaultPosition>) -> Result<()> {
    let oracle = &ctx.accounts.oracle;
    let position = &ctx.accounts.borrow_position;

    // Market must be resolved
    require!(oracle.resolved, VeroError::MarketNotResolved);

    // Must have outstanding debt
    require!(position.borrowed_amount > 0, VeroError::NoOutstandingDebt);

    // 48-hour grace period must have elapsed since resolution
    let now = Clock::get()?.unix_timestamp;
    let deadline = oracle
        .last_update_ts
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(VeroError::MathOverflow)?;
    require!(now >= deadline, VeroError::GracePeriodActive);

    let collateral_amount = position.collateral_amount;
    let borrowed_amount = position.borrowed_amount;

    // Burn the forfeited collateral
    let usdc_mint_key = ctx.accounts.pool.usdc_mint;
    let market_mint_key = ctx.accounts.pool.market_mint;
    let pool_seeds = &[
        b"pool".as_ref(),
        usdc_mint_key.as_ref(),
        market_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    if collateral_amount > 0 {
        let cpi_accounts = Burn {
            mint: ctx.accounts.collateral_mint.to_account_info(),
            from: ctx.accounts.collateral_vault.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::burn(cpi_ctx, collateral_amount)?;
    }

    // Close collateral vault, return rent to caller
    let cpi_accounts = CloseAccount {
        account: ctx.accounts.collateral_vault.to_account_info(),
        destination: ctx.accounts.caller.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::close_account(cpi_ctx)?;

    // Write off bad debt
    let pool = &mut ctx.accounts.pool;
    pool.total_borrowed = pool.total_borrowed.saturating_sub(borrowed_amount);
    // Lenders absorb the loss: reduce total_deposits by the defaulted amount
    pool.total_deposits = pool.total_deposits.saturating_sub(borrowed_amount);

    // Zero out position
    let position = &mut ctx.accounts.borrow_position;
    position.collateral_amount = 0;
    position.borrowed_amount = 0;
    position.accrued_interest = 0;

    Ok(())
}

#[derive(Accounts)]
pub struct DefaultPosition<'info> {
    /// Anyone can call default after the grace period expires.
    #[account(mut)]
    pub caller: Signer<'info>,

    /// The borrower who failed to repay.
    /// CHECK: Only used as a seed for the borrow position PDA.
    pub borrower: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.usdc_mint.as_ref(), pool.market_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(mut)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"oracle", collateral_mint.key().as_ref()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, ProbabilityOracle>,

    #[account(
        mut,
        seeds = [b"borrow", pool.key().as_ref(), borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = borrow_position.bump,
        constraint = borrow_position.owner == borrower.key(),
    )]
    pub borrow_position: Account<'info, BorrowPosition>,

    #[account(
        mut,
        seeds = [b"collateral_vault", borrow_position.key().as_ref()],
        bump = borrow_position.collateral_vault_bump,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}
