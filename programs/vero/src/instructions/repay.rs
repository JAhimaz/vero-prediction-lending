use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::VeroError;
use crate::state::{BorrowPosition, LendingPool};

pub fn handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    // Accrue interest first
    let now = Clock::get()?.unix_timestamp;
    let interest_rate = ctx.accounts.pool.interest_rate_bps;
    ctx.accounts.borrow_position.accrue(now, interest_rate);

    let total_debt = ctx.accounts.borrow_position.total_debt();
    require!(amount <= total_debt, VeroError::RepayExceedsDebt);

    let is_full_repay = amount == total_debt;

    // Transfer USDC from borrower to pool vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.borrower_usdc.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.borrower.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, 6)?;

    // If full repay, return all collateral
    if is_full_repay {
        let pool = &ctx.accounts.pool;
        let usdc_mint_key = pool.usdc_mint;
        let pool_seeds = &[
            b"pool".as_ref(),
            usdc_mint_key.as_ref(),
            &[pool.bump],
        ];
        let signer_seeds = &[&pool_seeds[..]];

        let collateral_amount = ctx.accounts.borrow_position.collateral_amount;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.collateral_vault.to_account_info(),
            mint: ctx.accounts.collateral_mint.to_account_info(),
            to: ctx.accounts.borrower_collateral.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, collateral_amount, 6)?;

        // Close the collateral vault
        let cpi_accounts = CloseAccount {
            account: ctx.accounts.collateral_vault.to_account_info(),
            destination: ctx.accounts.borrower.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::close_account(cpi_ctx)?;
    }

    // Apply repayment: interest first, then principal
    let position = &mut ctx.accounts.borrow_position;
    let pool = &mut ctx.accounts.pool;

    if is_full_repay {
        // Interest portion goes to lenders (increases total_deposits, shares stay same → APR)
        let interest_paid = position.accrued_interest;
        pool.total_deposits = pool.total_deposits.saturating_add(interest_paid);
        pool.total_borrowed = pool.total_borrowed.saturating_sub(position.borrowed_amount);
        position.borrowed_amount = 0;
        position.accrued_interest = 0;
        position.collateral_amount = 0;
    } else {
        // Pay off accrued interest first, remainder reduces principal
        if amount <= position.accrued_interest {
            // All goes to interest → lender yield
            pool.total_deposits = pool.total_deposits.saturating_add(amount);
            position.accrued_interest = position.accrued_interest.saturating_sub(amount);
        } else {
            let interest_paid = position.accrued_interest;
            let principal_repaid = amount - interest_paid;
            // Interest portion → lender yield
            pool.total_deposits = pool.total_deposits.saturating_add(interest_paid);
            position.accrued_interest = 0;
            position.borrowed_amount = position.borrowed_amount.saturating_sub(principal_repaid);
            pool.total_borrowed = pool.total_borrowed.saturating_sub(principal_repaid);
        }
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.usdc_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    pub collateral_mint: InterfaceAccount<'info, Mint>,

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
        constraint = borrower_collateral.mint == collateral_mint.key(),
        constraint = borrower_collateral.owner == borrower.key(),
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

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
}
