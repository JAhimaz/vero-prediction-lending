"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import idlJson from "../../vero.json";

export const PROGRAM_ID = new PublicKey(idlJson.address);
const TREASURY = new PublicKey("2NQyirUKxb5MCvVQnae7W5rTk7LXj9BoMhQUHbjuWMzA");

export function findPoolPda(usdcMint: PublicKey, marketMint?: PublicKey): [PublicKey, number] {
  const seeds = marketMint
    ? [Buffer.from("pool"), usdcMint.toBuffer(), marketMint.toBuffer()]
    : [Buffer.from("pool"), usdcMint.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}
export function findVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID);
}
export function findLenderPositionPda(pool: PublicKey, lender: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()], PROGRAM_ID);
}
export function findOraclePda(marketMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle"), marketMint.toBuffer()], PROGRAM_ID);
}
export function findBorrowPositionPda(pool: PublicKey, borrower: PublicKey, collateralMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("borrow"), pool.toBuffer(), borrower.toBuffer(), collateralMint.toBuffer()], PROGRAM_ID);
}
export function findCollateralVaultPda(borrowPosition: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("collateral_vault"), borrowPosition.toBuffer()], PROGRAM_ID);
}

async function getOrCreateAta(
  connection: any,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ ata: PublicKey; createIx: any | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  try {
    await getAccount(connection, ata);
    return { ata, createIx: null };
  } catch {
    return { ata, createIx: createAssociatedTokenAccountInstruction(payer, ata, owner, mint) };
  }
}

/**
 * Hook for interacting with a specific Vero market.
 * Pass usdcMint + predictionMint to target a specific pool/oracle pair.
 */
export function useVero(usdcMint?: PublicKey, predictionMint?: PublicKey, marketMint?: PublicKey) {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [predictionBalance, setPredictionBalance] = useState<number>(0);

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idlJson as Idl, provider);
  }, [provider]);

  // Auto-resolve balances
  useEffect(() => {
    if (!wallet.publicKey || !usdcMint || !predictionMint) return;
    const resolve = async () => {
      try {
        const uAta = await getAssociatedTokenAddress(usdcMint, wallet.publicKey!);
        const acc = await getAccount(connection, uAta);
        setUsdcBalance(Number(acc.amount) / 1e6);
      } catch { setUsdcBalance(0); }
      try {
        const pAta = await getAssociatedTokenAddress(predictionMint, wallet.publicKey!);
        const acc = await getAccount(connection, pAta);
        setPredictionBalance(Number(acc.amount) / 1e6);
      } catch { setPredictionBalance(0); }
    };
    resolve();
  }, [wallet.publicKey, connection, usdcMint, predictionMint]);

  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey || !usdcMint || !predictionMint) return;
    try {
      const acc = await getAccount(connection, await getAssociatedTokenAddress(usdcMint, wallet.publicKey));
      setUsdcBalance(Number(acc.amount) / 1e6);
    } catch { setUsdcBalance(0); }
    try {
      const acc = await getAccount(connection, await getAssociatedTokenAddress(predictionMint, wallet.publicKey));
      setPredictionBalance(Number(acc.amount) / 1e6);
    } catch { setPredictionBalance(0); }
  }, [wallet.publicKey, connection, usdcMint, predictionMint]);

  const deposit = useCallback(async (amount: number) => {
    if (!program || !wallet.publicKey || !usdcMint) throw new Error("Not ready");
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [vault] = findVaultPda(pool);
    const [lenderPosition] = findLenderPositionPda(pool, wallet.publicKey);
    const { ata, createIx } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, wallet.publicKey);
    const { ata: treasuryUsdc, createIx: treasuryIx } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, TREASURY);
    const preIxs = [createIx, treasuryIx].filter(Boolean);
    const builder = program.methods.deposit(new BN(amount)).accounts({
      lender: wallet.publicKey, pool, lenderPosition, usdcMint, lenderUsdc: ata, vault,
      treasuryUsdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    });
    if (preIxs.length) builder.preInstructions(preIxs as any[]);
    const sig = await builder.rpc();
    await refreshBalances();
    return sig;
  }, [program, wallet.publicKey, connection, usdcMint, refreshBalances]);

  const withdraw = useCallback(async (amount: number) => {
    if (!program || !wallet.publicKey || !usdcMint) throw new Error("Not ready");
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [vault] = findVaultPda(pool);
    const [lenderPosition] = findLenderPositionPda(pool, wallet.publicKey);
    const { ata, createIx } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, wallet.publicKey);
    const builder = program.methods.withdraw(new BN(amount)).accounts({
      lender: wallet.publicKey, pool, lenderPosition, usdcMint, lenderUsdc: ata, vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    if (createIx) builder.preInstructions([createIx]);
    const sig = await builder.rpc();
    await refreshBalances();
    return sig;
  }, [program, wallet.publicKey, connection, usdcMint, refreshBalances]);

  const borrow = useCallback(async (collateralAmount: number, borrowAmount: number) => {
    if (!program || !wallet.publicKey || !usdcMint || !predictionMint) throw new Error("Not ready");
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [vault] = findVaultPda(pool);
    const [oracle] = findOraclePda(predictionMint);
    const [borrowPosition] = findBorrowPositionPda(pool, wallet.publicKey, predictionMint);
    const [collateralVault] = findCollateralVaultPda(borrowPosition);
    const { ata: borrowerCollateral, createIx: ix1 } = await getOrCreateAta(connection, wallet.publicKey, predictionMint, wallet.publicKey);
    const { ata: borrowerUsdc, createIx: ix2 } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, wallet.publicKey);
    const { ata: treasuryUsdc, createIx: ix3 } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, TREASURY);
    const preIxs = [ix1, ix2, ix3].filter(Boolean);
    const builder = program.methods.borrow(new BN(collateralAmount), new BN(borrowAmount), new BN(0)).accounts({
      borrower: wallet.publicKey, pool, collateralMint: predictionMint, oracle, borrowPosition, collateralVault,
      borrowerCollateral, usdcMint, borrowerUsdc, vault, treasuryUsdc,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    });
    if (preIxs.length) builder.preInstructions(preIxs as any[]);
    const sig = await builder.rpc();
    await refreshBalances();
    return sig;
  }, [program, wallet.publicKey, connection, usdcMint, predictionMint, refreshBalances]);

  const repay = useCallback(async (amount: number) => {
    if (!program || !wallet.publicKey || !usdcMint || !predictionMint) throw new Error("Not ready");
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [vault] = findVaultPda(pool);
    const [borrowPosition] = findBorrowPositionPda(pool, wallet.publicKey, predictionMint);
    const [collateralVault] = findCollateralVaultPda(borrowPosition);
    const { ata: borrowerCollateral } = await getOrCreateAta(connection, wallet.publicKey, predictionMint, wallet.publicKey);
    const { ata: borrowerUsdc } = await getOrCreateAta(connection, wallet.publicKey, usdcMint, wallet.publicKey);
    const sig = await program.methods.repay(new BN(amount)).accounts({
      borrower: wallet.publicKey, pool, collateralMint: predictionMint, usdcMint, borrowPosition, collateralVault,
      borrowerCollateral, borrowerUsdc, vault, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    await refreshBalances();
    return sig;
  }, [program, wallet.publicKey, connection, usdcMint, predictionMint, refreshBalances]);

  const fetchPool = useCallback(async () => {
    if (!program || !usdcMint) return null;
    const [pool] = findPoolPda(usdcMint, marketMint);
    try { return await (program.account as any).lendingPool.fetch(pool); } catch { return null; }
  }, [program, usdcMint]);

  const fetchOracle = useCallback(async () => {
    if (!program || !predictionMint) return null;
    const [oracle] = findOraclePda(predictionMint);
    try { return await (program.account as any).probabilityOracle.fetch(oracle); } catch { return null; }
  }, [program, predictionMint]);

  const fetchBorrowPosition = useCallback(async () => {
    if (!program || !wallet.publicKey || !usdcMint || !predictionMint) return null;
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [pos] = findBorrowPositionPda(pool, wallet.publicKey, predictionMint);
    try { return await (program.account as any).borrowPosition.fetch(pos); } catch { return null; }
  }, [program, wallet.publicKey, usdcMint, predictionMint]);

  const fetchLenderPosition = useCallback(async () => {
    if (!program || !wallet.publicKey || !usdcMint) return null;
    const [pool] = findPoolPda(usdcMint, marketMint);
    const [pos] = findLenderPositionPda(pool, wallet.publicKey);
    try { return await (program.account as any).lenderPosition.fetch(pos); } catch { return null; }
  }, [program, wallet.publicKey, usdcMint]);

  return {
    program, provider, deposit, withdraw, borrow, repay,
    fetchPool, fetchOracle, fetchBorrowPosition, fetchLenderPosition, refreshBalances,
    connected: !!wallet.publicKey, publicKey: wallet.publicKey,
    usdcBalance, predictionBalance,
  };
}
