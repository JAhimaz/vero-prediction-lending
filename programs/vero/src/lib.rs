pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("3KX1asvGaP1h2UHaxbHoT4WA5Gf6Ex524zYwgwB2Cn3V");

#[program]
pub mod vero {
    use super::*;

    /// Initialize a new lending pool for USDC deposits.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        interest_rate_bps: u16,
        liquidation_bonus_bps: u16,
        max_ltv_bps: u16,
        liquidation_threshold_bps: u16,
    ) -> Result<()> {
        instructions::initialize_pool::handler(
            ctx,
            interest_rate_bps,
            liquidation_bonus_bps,
            max_ltv_bps,
            liquidation_threshold_bps,
        )
    }

    /// Deposit USDC into the lending pool as a lender.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Withdraw USDC from the lending pool.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    /// Initialize a probability oracle for a prediction market token.
    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        initial_probability_bps: u16,
        resolution_ts: i64,
    ) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, initial_probability_bps, resolution_ts)
    }

    /// Update the probability reading on an oracle.
    pub fn update_oracle(ctx: Context<UpdateOracle>, probability_bps: u16) -> Result<()> {
        instructions::initialize_oracle::update_handler(ctx, probability_bps)
    }

    /// Resolve a prediction market oracle.
    pub fn resolve_oracle(ctx: Context<UpdateOracle>, outcome: bool) -> Result<()> {
        instructions::initialize_oracle::resolve_handler(ctx, outcome)
    }

    /// Deposit prediction market tokens as collateral and borrow USDC.
    pub fn borrow(
        ctx: Context<Borrow>,
        collateral_amount: u64,
        borrow_amount: u64,
        resolution_ts: i64,
    ) -> Result<()> {
        instructions::borrow::handler(ctx, collateral_amount, borrow_amount, resolution_ts)
    }

    /// Repay borrowed USDC and reclaim collateral.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::handler(ctx, amount)
    }

    /// Liquidate an undercollateralized borrow position.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handler(ctx)
    }
}
