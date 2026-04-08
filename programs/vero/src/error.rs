use anchor_lang::prelude::*;

#[error_code]
pub enum VeroError {
    #[msg("Borrow amount exceeds maximum LTV for this collateral")]
    ExceedsMaxLtv,
    #[msg("Position is not eligible for liquidation")]
    NotLiquidatable,
    #[msg("Repay amount exceeds outstanding debt")]
    RepayExceedsDebt,
    #[msg("Insufficient liquidity in the lending pool")]
    InsufficientPoolLiquidity,
    #[msg("Invalid oracle probability value")]
    InvalidProbability,
    #[msg("Market has already resolved")]
    MarketResolved,
    #[msg("Collateral amount must be greater than zero")]
    ZeroCollateral,
    #[msg("Borrow amount must be greater than zero")]
    ZeroBorrow,
    #[msg("Withdraw amount exceeds available balance")]
    InsufficientBalance,
    #[msg("Math overflow")]
    MathOverflow,
}
