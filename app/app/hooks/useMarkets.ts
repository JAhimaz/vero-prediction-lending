"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BorshCoder, Idl } from "@coral-xyz/anchor";
import idlJson from "../../vero.json";
import marketsConfig from "../markets.json";

const PROGRAM_ID = new PublicKey(idlJson.address);

export interface Market {
  name: string;
  symbol: string;
  metadaoQuestion: string;
  poolAddress: PublicKey;
  usdcMint: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  yesOracle: PublicKey;
  noOracle: PublicKey;
  probabilityBps: number;
  totalDeposits: number;
  totalBorrowed: number;
  availableLiquidity: number;
  interestRateBps: number;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  resolved: boolean;
  outcome: boolean;
  supplyAprPct: number;
}

export function useMarkets() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  const discoverMarkets = useCallback(async () => {
    try {
      const coder = new BorshCoder(idlJson as Idl);

      const poolKeys = marketsConfig.map((c) => new PublicKey(c.pool));
      const yesOracleKeys = marketsConfig.map((c) => new PublicKey((c as any).yesOracle || (c as any).oracle));
      const allKeys = [...poolKeys, ...yesOracleKeys];

      const allAccounts = await connection.getMultipleAccountsInfo(allKeys);

      const discovered: Market[] = [];

      for (let i = 0; i < marketsConfig.length; i++) {
        const cfg = marketsConfig[i] as any;
        const poolAccount = allAccounts[i];
        const oracleAccount = allAccounts[marketsConfig.length + i];

        if (!poolAccount || !oracleAccount) continue;

        try {
          const poolData = coder.accounts.decode("LendingPool", poolAccount.data);
          const oracleData = coder.accounts.decode("ProbabilityOracle", oracleAccount.data);

          discovered.push({
            name: cfg.name,
            symbol: cfg.symbol || "TOKEN",
            metadaoQuestion: cfg.metadaoQuestion || "",
            poolAddress: poolKeys[i],
            usdcMint: new PublicKey(cfg.usdcMint),
            yesMint: new PublicKey(cfg.yesMint || cfg.predictionMint),
            noMint: new PublicKey(cfg.noMint || cfg.yesMint || cfg.predictionMint),
            yesOracle: yesOracleKeys[i],
            noOracle: new PublicKey(cfg.noOracle || cfg.yesOracle || cfg.oracle),
            probabilityBps: (oracleData as any).probability_bps,
            totalDeposits: (poolData as any).total_deposits.toNumber() / 1e6,
            totalBorrowed: (poolData as any).total_borrowed.toNumber() / 1e6,
            availableLiquidity:
              ((poolData as any).total_deposits.toNumber() - (poolData as any).total_borrowed.toNumber()) / 1e6,
            interestRateBps: (poolData as any).interest_rate_bps,
            maxLtvBps: (poolData as any).max_ltv_bps,
            liquidationThresholdBps: (poolData as any).liquidation_threshold_bps,
            resolved: (oracleData as any).resolved,
            outcome: (oracleData as any).outcome,
            supplyAprPct: (() => {
              const deposits = (poolData as any).total_deposits.toNumber();
              const borrowed = (poolData as any).total_borrowed.toNumber();
              const rateBps = (poolData as any).interest_rate_bps;
              if (deposits === 0) return 0;
              const utilization = borrowed / deposits;
              return (rateBps / 100) * utilization;
            })(),
          });
        } catch {
          // Skip markets that fail to decode
        }
      }

      setMarkets(discovered);
    } catch (e) {
      console.error("Failed to load markets:", e);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  const refresh = useCallback(async () => {
    await discoverMarkets();
  }, [discoverMarkets]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { markets, loading, refresh };
}
