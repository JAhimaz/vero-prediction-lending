import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idlJson from "./idl.json";
export declare const VERO_PROGRAM_ID: PublicKey;
export declare function findPoolPda(usdcMint: PublicKey): [PublicKey, number];
export declare function findVaultPda(pool: PublicKey): [PublicKey, number];
export declare function findLenderPositionPda(pool: PublicKey, lender: PublicKey): [PublicKey, number];
export declare function findOraclePda(marketMint: PublicKey): [PublicKey, number];
export declare function findBorrowPositionPda(pool: PublicKey, borrower: PublicKey, collateralMint: PublicKey): [PublicKey, number];
export declare function findCollateralVaultPda(borrowPosition: PublicKey): [PublicKey, number];
export interface LendingPool {
    authority: PublicKey;
    usdcMint: PublicKey;
    vault: PublicKey;
    totalDeposits: BN;
    totalBorrowed: BN;
    interestRateBps: number;
    liquidationBonusBps: number;
    maxLtvBps: number;
    liquidationThresholdBps: number;
    bump: number;
    vaultBump: number;
}
export interface LenderPosition {
    owner: PublicKey;
    pool: PublicKey;
    depositedAmount: BN;
    lastUpdateTs: BN;
    bump: number;
}
export interface BorrowPosition {
    owner: PublicKey;
    pool: PublicKey;
    collateralMint: PublicKey;
    collateralAmount: BN;
    borrowedAmount: BN;
    entryProbabilityBps: number;
    openedAt: BN;
    resolutionTs: BN;
    bump: number;
    collateralVaultBump: number;
}
export interface ProbabilityOracle {
    marketMint: PublicKey;
    probabilityBps: number;
    resolved: boolean;
    outcome: boolean;
    authority: PublicKey;
    lastUpdateTs: BN;
    bump: number;
}
export declare class VeroClient {
    program: Program;
    provider: AnchorProvider;
    constructor(provider: AnchorProvider);
    initializePool(usdcMint: PublicKey, params: {
        interestRateBps: number;
        liquidationBonusBps: number;
        maxLtvBps: number;
        liquidationThresholdBps: number;
    }): Promise<string>;
    deposit(usdcMint: PublicKey, amount: BN): Promise<string>;
    withdraw(usdcMint: PublicKey, amount: BN): Promise<string>;
    initializeOracle(marketMint: PublicKey, initialProbabilityBps: number, resolutionTs: BN): Promise<string>;
    updateOracle(marketMint: PublicKey, probabilityBps: number): Promise<string>;
    resolveOracle(marketMint: PublicKey, outcome: boolean): Promise<string>;
    borrow(usdcMint: PublicKey, collateralMint: PublicKey, collateralAmount: BN, borrowAmount: BN, resolutionTs: BN, borrowerCollateralAta: PublicKey, borrowerUsdcAta: PublicKey): Promise<string>;
    repay(usdcMint: PublicKey, collateralMint: PublicKey, amount: BN, borrowerCollateralAta: PublicKey, borrowerUsdcAta: PublicKey): Promise<string>;
    liquidate(usdcMint: PublicKey, collateralMint: PublicKey, borrowerPubkey: PublicKey, liquidatorCollateralAta: PublicKey, liquidatorUsdcAta: PublicKey): Promise<string>;
    fetchPool(usdcMint: PublicKey): Promise<LendingPool>;
    fetchLenderPosition(usdcMint: PublicKey, lender: PublicKey): Promise<LenderPosition>;
    fetchBorrowPosition(usdcMint: PublicKey, borrower: PublicKey, collateralMint: PublicKey): Promise<BorrowPosition>;
    fetchOracle(marketMint: PublicKey): Promise<ProbabilityOracle>;
    getAvailableLiquidity(usdcMint: PublicKey): Promise<BN>;
    calculateMaxBorrow(collateralAmount: BN, probabilityBps: number, maxLtvBps: number): BN;
    private findAssociatedTokenAddress;
}
export { idlJson as IDL };
