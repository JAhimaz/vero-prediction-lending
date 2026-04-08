"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDL = exports.VeroClient = exports.VERO_PROGRAM_ID = void 0;
exports.findPoolPda = findPoolPda;
exports.findVaultPda = findVaultPda;
exports.findLenderPositionPda = findLenderPositionPda;
exports.findOraclePda = findOraclePda;
exports.findBorrowPositionPda = findBorrowPositionPda;
exports.findCollateralVaultPda = findCollateralVaultPda;
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const idl_json_1 = __importDefault(require("./idl.json"));
exports.IDL = idl_json_1.default;
exports.VERO_PROGRAM_ID = new web3_js_1.PublicKey(idl_json_1.default.address);
// PDA derivation helpers
function findPoolPda(usdcMint) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("pool"), usdcMint.toBuffer()], exports.VERO_PROGRAM_ID);
}
function findVaultPda(pool) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], exports.VERO_PROGRAM_ID);
}
function findLenderPositionPda(pool, lender) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()], exports.VERO_PROGRAM_ID);
}
function findOraclePda(marketMint) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("oracle"), marketMint.toBuffer()], exports.VERO_PROGRAM_ID);
}
function findBorrowPositionPda(pool, borrower, collateralMint) {
    return web3_js_1.PublicKey.findProgramAddressSync([
        Buffer.from("borrow"),
        pool.toBuffer(),
        borrower.toBuffer(),
        collateralMint.toBuffer(),
    ], exports.VERO_PROGRAM_ID);
}
function findCollateralVaultPda(borrowPosition) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("collateral_vault"), borrowPosition.toBuffer()], exports.VERO_PROGRAM_ID);
}
// Client class
class VeroClient {
    constructor(provider) {
        this.provider = provider;
        this.program = new anchor_1.Program(idl_json_1.default, provider);
    }
    // === Pool Operations ===
    async initializePool(usdcMint, params) {
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        return this.program.methods
            .initializePool(params.interestRateBps, params.liquidationBonusBps, params.maxLtvBps, params.liquidationThresholdBps)
            .accounts({
            authority: this.provider.wallet.publicKey,
            usdcMint,
            pool,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    // === Lender Operations ===
    async deposit(usdcMint, amount) {
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        const lender = this.provider.wallet.publicKey;
        const [lenderPosition] = findLenderPositionPda(pool, lender);
        const lenderUsdc = await this.findAssociatedTokenAddress(lender, usdcMint);
        return this.program.methods
            .deposit(amount)
            .accounts({
            lender,
            pool,
            lenderPosition,
            usdcMint,
            lenderUsdc,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    async withdraw(usdcMint, amount) {
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        const lender = this.provider.wallet.publicKey;
        const [lenderPosition] = findLenderPositionPda(pool, lender);
        const lenderUsdc = await this.findAssociatedTokenAddress(lender, usdcMint);
        return this.program.methods
            .withdraw(amount)
            .accounts({
            lender,
            pool,
            lenderPosition,
            usdcMint,
            lenderUsdc,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        })
            .rpc();
    }
    // === Oracle Operations ===
    async initializeOracle(marketMint, initialProbabilityBps, resolutionTs) {
        const [oracle] = findOraclePda(marketMint);
        return this.program.methods
            .initializeOracle(initialProbabilityBps, resolutionTs)
            .accounts({
            authority: this.provider.wallet.publicKey,
            marketMint,
            oracle,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    async updateOracle(marketMint, probabilityBps) {
        const [oracle] = findOraclePda(marketMint);
        return this.program.methods
            .updateOracle(probabilityBps)
            .accounts({
            authority: this.provider.wallet.publicKey,
            oracle,
        })
            .rpc();
    }
    async resolveOracle(marketMint, outcome) {
        const [oracle] = findOraclePda(marketMint);
        return this.program.methods
            .resolveOracle(outcome)
            .accounts({
            authority: this.provider.wallet.publicKey,
            oracle,
        })
            .rpc();
    }
    // === Borrower Operations ===
    async borrow(usdcMint, collateralMint, collateralAmount, borrowAmount, resolutionTs, borrowerCollateralAta, borrowerUsdcAta) {
        const borrower = this.provider.wallet.publicKey;
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        const [oracle] = findOraclePda(collateralMint);
        const [borrowPosition] = findBorrowPositionPda(pool, borrower, collateralMint);
        const [collateralVault] = findCollateralVaultPda(borrowPosition);
        return this.program.methods
            .borrow(collateralAmount, borrowAmount, resolutionTs)
            .accounts({
            borrower,
            pool,
            collateralMint,
            oracle,
            borrowPosition,
            collateralVault,
            borrowerCollateral: borrowerCollateralAta,
            usdcMint,
            borrowerUsdc: borrowerUsdcAta,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    async repay(usdcMint, collateralMint, amount, borrowerCollateralAta, borrowerUsdcAta) {
        const borrower = this.provider.wallet.publicKey;
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        const [borrowPosition] = findBorrowPositionPda(pool, borrower, collateralMint);
        const [collateralVault] = findCollateralVaultPda(borrowPosition);
        return this.program.methods
            .repay(amount)
            .accounts({
            borrower,
            pool,
            collateralMint,
            usdcMint,
            borrowPosition,
            collateralVault,
            borrowerCollateral: borrowerCollateralAta,
            borrowerUsdc: borrowerUsdcAta,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        })
            .rpc();
    }
    // === Liquidation ===
    async liquidate(usdcMint, collateralMint, borrowerPubkey, liquidatorCollateralAta, liquidatorUsdcAta) {
        const liquidator = this.provider.wallet.publicKey;
        const [pool] = findPoolPda(usdcMint);
        const [vault] = findVaultPda(pool);
        const [oracle] = findOraclePda(collateralMint);
        const [borrowPosition] = findBorrowPositionPda(pool, borrowerPubkey, collateralMint);
        const [collateralVault] = findCollateralVaultPda(borrowPosition);
        return this.program.methods
            .liquidate()
            .accounts({
            liquidator,
            borrower: borrowerPubkey,
            pool,
            collateralMint,
            oracle,
            usdcMint,
            borrowPosition,
            collateralVault,
            liquidatorUsdc: liquidatorUsdcAta,
            liquidatorCollateral: liquidatorCollateralAta,
            vault,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        })
            .rpc();
    }
    // === Read Operations ===
    async fetchPool(usdcMint) {
        const [pool] = findPoolPda(usdcMint);
        return this.program.account.lendingPool.fetch(pool);
    }
    async fetchLenderPosition(usdcMint, lender) {
        const [pool] = findPoolPda(usdcMint);
        const [pos] = findLenderPositionPda(pool, lender);
        return this.program.account.lenderPosition.fetch(pos);
    }
    async fetchBorrowPosition(usdcMint, borrower, collateralMint) {
        const [pool] = findPoolPda(usdcMint);
        const [pos] = findBorrowPositionPda(pool, borrower, collateralMint);
        return this.program.account.borrowPosition.fetch(pos);
    }
    async fetchOracle(marketMint) {
        const [oracle] = findOraclePda(marketMint);
        return this.program.account.probabilityOracle.fetch(oracle);
    }
    // === Utility ===
    async getAvailableLiquidity(usdcMint) {
        const pool = await this.fetchPool(usdcMint);
        return pool.totalDeposits.sub(pool.totalBorrowed);
    }
    calculateMaxBorrow(collateralAmount, probabilityBps, maxLtvBps) {
        const collateralValue = collateralAmount
            .mul(new anchor_1.BN(probabilityBps))
            .div(new anchor_1.BN(10000));
        return collateralValue.mul(new anchor_1.BN(maxLtvBps)).div(new anchor_1.BN(10000));
    }
    async findAssociatedTokenAddress(owner, mint) {
        const [address] = web3_js_1.PublicKey.findProgramAddressSync([owner.toBuffer(), spl_token_1.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], new web3_js_1.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"));
        return address;
    }
}
exports.VeroClient = VeroClient;
