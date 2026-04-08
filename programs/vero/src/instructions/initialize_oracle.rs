use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::error::VeroError;
use crate::state::ProbabilityOracle;

pub fn handler(
    ctx: Context<InitializeOracle>,
    initial_probability_bps: u16,
    _resolution_ts: i64,
) -> Result<()> {
    require!(initial_probability_bps <= 10000, VeroError::InvalidProbability);

    let oracle = &mut ctx.accounts.oracle;
    oracle.market_mint = ctx.accounts.market_mint.key();
    oracle.probability_bps = initial_probability_bps;
    oracle.resolved = false;
    oracle.outcome = false;
    oracle.authority = ctx.accounts.authority.key();
    oracle.last_update_ts = Clock::get()?.unix_timestamp;
    oracle.bump = ctx.bumps.oracle;
    Ok(())
}

pub fn update_handler(ctx: Context<UpdateOracle>, probability_bps: u16) -> Result<()> {
    require!(probability_bps <= 10000, VeroError::InvalidProbability);
    let oracle = &mut ctx.accounts.oracle;
    require!(!oracle.resolved, VeroError::MarketResolved);
    oracle.probability_bps = probability_bps;
    oracle.last_update_ts = Clock::get()?.unix_timestamp;
    Ok(())
}

pub fn resolve_handler(ctx: Context<UpdateOracle>, outcome: bool) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    require!(!oracle.resolved, VeroError::MarketResolved);
    oracle.resolved = true;
    oracle.outcome = outcome;
    oracle.probability_bps = if outcome { 10000 } else { 0 };
    oracle.last_update_ts = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub market_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = ProbabilityOracle::LEN,
        seeds = [b"oracle", market_mint.key().as_ref()],
        bump,
    )]
    pub oracle: Account<'info, ProbabilityOracle>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    #[account(
        constraint = authority.key() == oracle.authority,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"oracle", oracle.market_mint.as_ref()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, ProbabilityOracle>,
}
