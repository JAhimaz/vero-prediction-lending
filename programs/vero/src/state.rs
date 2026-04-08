use anchor_lang::prelude::*;

/// Global lending pool that holds USDC deposits from lenders.
#[account]
pub struct LendingPool {
    /// Authority (admin) that can update pool parameters
    pub authority: Pubkey,
    /// USDC mint address
    pub usdc_mint: Pubkey,
    /// Pool's USDC token account (vault)
    pub vault: Pubkey,
    /// Total USDC deposited by lenders
    pub total_deposits: u64,
    /// Total USDC currently borrowed
    pub total_borrowed: u64,
    /// Annual interest rate in basis points (e.g., 500 = 5%)
    pub interest_rate_bps: u16,
    /// Liquidation bonus in basis points (e.g., 500 = 5% discount for liquidators)
    pub liquidation_bonus_bps: u16,
    /// Maximum LTV ratio in basis points (e.g., 5000 = 50%)
    pub max_ltv_bps: u16,
    /// Liquidation threshold in basis points (e.g., 6500 = 65%)
    pub liquidation_threshold_bps: u16,
    /// Bump seed for PDA
    pub bump: u8,
    /// Bump seed for vault PDA
    pub vault_bump: u8,
}

impl LendingPool {
    pub const LEN: usize = 8  // discriminator
        + 32  // authority
        + 32  // usdc_mint
        + 32  // vault
        + 8   // total_deposits
        + 8   // total_borrowed
        + 2   // interest_rate_bps
        + 2   // liquidation_bonus_bps
        + 2   // max_ltv_bps
        + 2   // liquidation_threshold_bps
        + 1   // bump
        + 1;  // vault_bump

    pub fn available_liquidity(&self) -> u64 {
        self.total_deposits.saturating_sub(self.total_borrowed)
    }
}

/// A lender's deposit position in the pool.
#[account]
pub struct LenderPosition {
    /// The lender's wallet
    pub owner: Pubkey,
    /// The lending pool this position belongs to
    pub pool: Pubkey,
    /// Amount of USDC deposited
    pub deposited_amount: u64,
    /// Timestamp of last deposit/withdrawal
    pub last_update_ts: i64,
    /// Bump seed
    pub bump: u8,
}

impl LenderPosition {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 32  // pool
        + 8   // deposited_amount
        + 8   // last_update_ts
        + 1;  // bump
}

/// Seconds in a 365-day year, used for interest calculations.
const SECONDS_PER_YEAR: u128 = 365 * 24 * 60 * 60;

/// A borrower's collateralized debt position.
#[account]
pub struct BorrowPosition {
    /// The borrower's wallet
    pub owner: Pubkey,
    /// The lending pool this position borrows from
    pub pool: Pubkey,
    /// Mint of the prediction market token used as collateral
    pub collateral_mint: Pubkey,
    /// Amount of prediction tokens deposited as collateral
    pub collateral_amount: u64,
    /// Principal USDC borrowed (excluding interest)
    pub borrowed_amount: u64,
    /// Accumulated interest owed (in USDC base units)
    pub accrued_interest: u64,
    /// Market probability at time of borrow (basis points, e.g., 7500 = 75%)
    pub entry_probability_bps: u16,
    /// Timestamp the position was opened
    pub opened_at: i64,
    /// Timestamp of last interest accrual
    pub last_accrual_ts: i64,
    /// Timestamp of the market resolution (0 if unknown)
    pub resolution_ts: i64,
    /// Bump seed
    pub bump: u8,
    /// Bump seed for collateral vault PDA
    pub collateral_vault_bump: u8,
}

impl BorrowPosition {
    pub const LEN: usize = 8   // discriminator
        + 32  // owner
        + 32  // pool
        + 32  // collateral_mint
        + 8   // collateral_amount
        + 8   // borrowed_amount
        + 8   // accrued_interest
        + 2   // entry_probability_bps
        + 8   // opened_at
        + 8   // last_accrual_ts
        + 8   // resolution_ts
        + 1   // bump
        + 1;  // collateral_vault_bump

    /// Calculate interest accrued since last update.
    /// interest = principal * rate_bps / 10000 * elapsed_seconds / seconds_per_year
    pub fn calculate_accrued_interest(&self, now: i64, interest_rate_bps: u16) -> u64 {
        if now <= self.last_accrual_ts || self.borrowed_amount == 0 {
            return 0;
        }
        let elapsed = (now - self.last_accrual_ts) as u128;
        let interest = (self.borrowed_amount as u128)
            .checked_mul(interest_rate_bps as u128)
            .unwrap_or(0)
            .checked_mul(elapsed)
            .unwrap_or(0)
            / (10000u128 * SECONDS_PER_YEAR);
        interest as u64
    }

    /// Total debt = principal + accrued interest
    pub fn total_debt(&self) -> u64 {
        self.borrowed_amount.saturating_add(self.accrued_interest)
    }

    /// Accrue interest up to `now` and update the timestamp.
    pub fn accrue(&mut self, now: i64, interest_rate_bps: u16) {
        let new_interest = self.calculate_accrued_interest(now, interest_rate_bps);
        self.accrued_interest = self.accrued_interest.saturating_add(new_interest);
        self.last_accrual_ts = now;
    }
}

/// Oracle account storing current probability for a prediction market token.
/// In production this would read from DFlow/Pyth; for now it's admin-updatable.
#[account]
pub struct ProbabilityOracle {
    /// The prediction market token mint this oracle prices
    pub market_mint: Pubkey,
    /// Current probability in basis points (0-10000)
    pub probability_bps: u16,
    /// Whether the market has resolved
    pub resolved: bool,
    /// If resolved, whether the outcome was YES (true) or NO (false)
    pub outcome: bool,
    /// Authority allowed to update this oracle
    pub authority: Pubkey,
    /// Last update timestamp
    pub last_update_ts: i64,
    /// Bump seed
    pub bump: u8,
}

impl ProbabilityOracle {
    pub const LEN: usize = 8  // discriminator
        + 32  // market_mint
        + 2   // probability_bps
        + 1   // resolved
        + 1   // outcome
        + 32  // authority
        + 8   // last_update_ts
        + 1;  // bump
}
