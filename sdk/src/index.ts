import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Connection,
  Keypair,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idlJson from "./idl.json";

export const VERO_PROGRAM_ID = new PublicKey(idlJson.address);

// PDA derivation helpers

export function findPoolPda(usdcMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), usdcMint.toBuffer()],
    VERO_PROGRAM_ID
  );
}

export function findVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()],
    VERO_PROGRAM_ID
  );
}

export function findLenderPositionPda(
  pool: PublicKey,
  lender: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()],
    VERO_PROGRAM_ID
  );
}

export function findOraclePda(marketMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), marketMint.toBuffer()],
    VERO_PROGRAM_ID
  );
}

export function findBorrowPositionPda(
  pool: PublicKey,
  borrower: PublicKey,
  collateralMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("borrow"),
      pool.toBuffer(),
      borrower.toBuffer(),
      collateralMint.toBuffer(),
    ],
    VERO_PROGRAM_ID
  );
}

export function findCollateralVaultPda(
  borrowPosition: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault"), borrowPosition.toBuffer()],
    VERO_PROGRAM_ID
  );
}

// Account types

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

// Client class

export class VeroClient {
  program: Program;
  provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(idlJson as Idl, provider);
  }

  // === Pool Operations ===

  async initializePool(
    usdcMint: PublicKey,
    params: {
      interestRateBps: number;
      liquidationBonusBps: number;
      maxLtvBps: number;
      liquidationThresholdBps: number;
    }
  ) {
    const [pool] = findPoolPda(usdcMint);
    const [vault] = findVaultPda(pool);

    return this.program.methods
      .initializePool(
        params.interestRateBps,
        params.liquidationBonusBps,
        params.maxLtvBps,
        params.liquidationThresholdBps
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        usdcMint,
        pool,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // === Lender Operations ===

  async deposit(usdcMint: PublicKey, amount: BN) {
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
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async withdraw(usdcMint: PublicKey, amount: BN) {
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
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // === Oracle Operations ===

  async initializeOracle(
    marketMint: PublicKey,
    initialProbabilityBps: number,
    resolutionTs: BN
  ) {
    const [oracle] = findOraclePda(marketMint);

    return this.program.methods
      .initializeOracle(initialProbabilityBps, resolutionTs)
      .accounts({
        authority: this.provider.wallet.publicKey,
        marketMint,
        oracle,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async updateOracle(marketMint: PublicKey, probabilityBps: number) {
    const [oracle] = findOraclePda(marketMint);

    return this.program.methods
      .updateOracle(probabilityBps)
      .accounts({
        authority: this.provider.wallet.publicKey,
        oracle,
      })
      .rpc();
  }

  async resolveOracle(marketMint: PublicKey, outcome: boolean) {
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

  async borrow(
    usdcMint: PublicKey,
    collateralMint: PublicKey,
    collateralAmount: BN,
    borrowAmount: BN,
    resolutionTs: BN,
    borrowerCollateralAta: PublicKey,
    borrowerUsdcAta: PublicKey
  ) {
    const borrower = this.provider.wallet.publicKey;
    const [pool] = findPoolPda(usdcMint);
    const [vault] = findVaultPda(pool);
    const [oracle] = findOraclePda(collateralMint);
    const [borrowPosition] = findBorrowPositionPda(
      pool,
      borrower,
      collateralMint
    );
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
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async repay(
    usdcMint: PublicKey,
    collateralMint: PublicKey,
    amount: BN,
    borrowerCollateralAta: PublicKey,
    borrowerUsdcAta: PublicKey
  ) {
    const borrower = this.provider.wallet.publicKey;
    const [pool] = findPoolPda(usdcMint);
    const [vault] = findVaultPda(pool);
    const [borrowPosition] = findBorrowPositionPda(
      pool,
      borrower,
      collateralMint
    );
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
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // === Liquidation ===

  async liquidate(
    usdcMint: PublicKey,
    collateralMint: PublicKey,
    borrowerPubkey: PublicKey,
    liquidatorCollateralAta: PublicKey,
    liquidatorUsdcAta: PublicKey
  ) {
    const liquidator = this.provider.wallet.publicKey;
    const [pool] = findPoolPda(usdcMint);
    const [vault] = findVaultPda(pool);
    const [oracle] = findOraclePda(collateralMint);
    const [borrowPosition] = findBorrowPositionPda(
      pool,
      borrowerPubkey,
      collateralMint
    );
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
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // === Read Operations ===

  async fetchPool(usdcMint: PublicKey): Promise<LendingPool> {
    const [pool] = findPoolPda(usdcMint);
    return (this.program.account as any).lendingPool.fetch(pool) as Promise<LendingPool>;
  }

  async fetchLenderPosition(
    usdcMint: PublicKey,
    lender: PublicKey
  ): Promise<LenderPosition> {
    const [pool] = findPoolPda(usdcMint);
    const [pos] = findLenderPositionPda(pool, lender);
    return (this.program.account as any).lenderPosition.fetch(
      pos
    ) as Promise<LenderPosition>;
  }

  async fetchBorrowPosition(
    usdcMint: PublicKey,
    borrower: PublicKey,
    collateralMint: PublicKey
  ): Promise<BorrowPosition> {
    const [pool] = findPoolPda(usdcMint);
    const [pos] = findBorrowPositionPda(pool, borrower, collateralMint);
    return (this.program.account as any).borrowPosition.fetch(
      pos
    ) as Promise<BorrowPosition>;
  }

  async fetchOracle(marketMint: PublicKey): Promise<ProbabilityOracle> {
    const [oracle] = findOraclePda(marketMint);
    return (this.program.account as any).probabilityOracle.fetch(
      oracle
    ) as Promise<ProbabilityOracle>;
  }

  // === Utility ===

  async getAvailableLiquidity(usdcMint: PublicKey): Promise<BN> {
    const pool = await this.fetchPool(usdcMint);
    return pool.totalDeposits.sub(pool.totalBorrowed);
  }

  calculateMaxBorrow(
    collateralAmount: BN,
    probabilityBps: number,
    maxLtvBps: number
  ): BN {
    const collateralValue = collateralAmount
      .mul(new BN(probabilityBps))
      .div(new BN(10000));
    return collateralValue.mul(new BN(maxLtvBps)).div(new BN(10000));
  }

  private async findAssociatedTokenAddress(
    owner: PublicKey,
    mint: PublicKey
  ): Promise<PublicKey> {
    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    );
    return address;
  }
}

export { idlJson as IDL };
