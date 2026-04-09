use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::VeroError;
use crate::state::{BorrowPosition, LendingPool, ProbabilityOracle};

/// Checks whether a position is liquidatable.
/// A position is liquidatable when:
///   collateral_value < borrowed_amount * 10000 / liquidation_threshold_bps
/// where collateral_value = collateral_amount * probability_bps / 10000
fn is_liquidatable(
    collateral_amount: u64,
    probability_bps: u16,
    borrowed_amount: u64,
    liquidation_threshold_bps: u16,
) -> Result<bool> {
    let collateral_value = (collateral_amount as u128)
        .checked_mul(probability_bps as u128)
        .ok_or(VeroError::MathOverflow)?;

    // collateral_amount * prob_bps * threshold_bps < borrowed * 10000 * 10000
    let lhs = collateral_value
        .checked_mul(liquidation_threshold_bps as u128)
        .ok_or(VeroError::MathOverflow)?;

    let rhs = (borrowed_amount as u128)
        .checked_mul(10000u128 * 10000u128)
        .ok_or(VeroError::MathOverflow)?;

    Ok(lhs < rhs)
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    // Accrue interest first
    let now = Clock::get()?.unix_timestamp;
    let interest_rate = ctx.accounts.pool.interest_rate_bps;
    ctx.accounts.borrow_position.accrue(now, interest_rate);

    let oracle = &ctx.accounts.oracle;
    let position = &ctx.accounts.borrow_position;
    let pool = &ctx.accounts.pool;

    // Check position is liquidatable (using total debt including interest)
    let liquidatable = is_liquidatable(
        position.collateral_amount,
        oracle.probability_bps,
        position.total_debt(),
        pool.liquidation_threshold_bps,
    )?;
    require!(liquidatable, VeroError::NotLiquidatable);

    let debt = position.total_debt();
    let collateral_amount = position.collateral_amount;

    // Calculate liquidation fee
    let fee_bps = pool.liquidation_fee_bps;
    let fee = (debt as u128 * fee_bps as u128 / 10000) as u64;
    let total_payment = debt.saturating_add(fee);

    // Liquidator repays the full debt + fee
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.liquidator_usdc.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.liquidator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, total_payment, 6)?;

    // Liquidator receives all collateral (at a discount — that's the incentive)
    let usdc_mint_key = pool.usdc_mint;
    let pool_seeds = &[
        b"pool".as_ref(),
        usdc_mint_key.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.collateral_vault.to_account_info(),
        mint: ctx.accounts.collateral_mint.to_account_info(),
        to: ctx.accounts.liquidator_collateral.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, collateral_amount, 6)?;

    // Close collateral vault
    let cpi_accounts = CloseAccount {
        account: ctx.accounts.collateral_vault.to_account_info(),
        destination: ctx.accounts.liquidator.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::close_account(cpi_ctx)?;

    // Transfer fee from vault to treasury
    if fee > 0 {
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

    // Update pool — interest portion goes to lenders as yield
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.borrow_position;
    let interest_paid = position.accrued_interest;
    pool.total_deposits = pool.total_deposits.saturating_add(interest_paid);
    pool.total_borrowed = pool.total_borrowed.saturating_sub(position.borrowed_amount);
    pool.total_fees_collected = pool.total_fees_collected.saturating_add(fee);

    // Zero out position
    position.collateral_amount = 0;
    position.borrowed_amount = 0;
    position.accrued_interest = 0;

    Ok(())
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    /// The original borrower (not signing — anyone can liquidate)
    /// CHECK: Only used as a seed for the borrow position PDA
    pub borrower: UncheckedAccount<'info>,

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

    pub usdc_mint: InterfaceAccount<'info, Mint>,

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

    #[account(
        mut,
        constraint = liquidator_usdc.mint == pool.usdc_mint,
        constraint = liquidator_usdc.owner == liquidator.key(),
    )]
    pub liquidator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = liquidator_collateral.mint == collateral_mint.key(),
        constraint = liquidator_collateral.owner == liquidator.key(),
    )]
    pub liquidator_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

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
}
