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
  slug: string;
  polymarketUrl: string;
  poolAddress: PublicKey;
  usdcMint: PublicKey;
  predictionMint: PublicKey;
  oracleAddress: PublicKey;
  probabilityBps: number;
  totalDeposits: number;
  totalBorrowed: number;
  availableLiquidity: number;
  interestRateBps: number;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  resolved: boolean;
  outcome: boolean;
  endDate: string | null;
  supplyAprPct: number;
}

export function useMarkets() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const livePrices = useRef<Map<string, number>>(new Map());
  const liveEndDates = useRef<Map<string, string>>(new Map());

  const fetchPolyPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const m of data) {
          livePrices.current.set(m.slug, m.yes);
          if (m.endDate) liveEndDates.current.set(m.slug, m.endDate);
        }
      }
    } catch {}
  }, []);

  const discoverMarkets = useCallback(async () => {
    try {
      const coder = new BorshCoder(idlJson as Idl);

      // Batch: collect all pool + oracle pubkeys
      const poolKeys = marketsConfig.map((c) => new PublicKey(c.pool));
      const oracleKeys = marketsConfig.map((c) => new PublicKey(c.oracle));
      const allKeys = [...poolKeys, ...oracleKeys];

      // Single RPC call for all accounts
      const allAccounts = await connection.getMultipleAccountsInfo(allKeys);

      const discovered: Market[] = [];

      for (let i = 0; i < marketsConfig.length; i++) {
        const cfg = marketsConfig[i];
        const poolAccount = allAccounts[i];
        const oracleAccount = allAccounts[marketsConfig.length + i];

        if (!poolAccount || !oracleAccount) continue;

        try {
          const poolData = coder.accounts.decode("LendingPool", poolAccount.data);
          const oracleData = coder.accounts.decode("ProbabilityOracle", oracleAccount.data);

          const livePrice = cfg.slug ? livePrices.current.get(cfg.slug) : undefined;
          const probBps = livePrice ?? (oracleData as any).probability_bps;

          discovered.push({
            name: cfg.name,
            slug: cfg.slug,
            polymarketUrl: cfg.polymarketUrl,
            poolAddress: poolKeys[i],
            usdcMint: new PublicKey(cfg.usdcMint),
            predictionMint: new PublicKey(cfg.predictionMint),
            oracleAddress: oracleKeys[i],
            probabilityBps: probBps,
            totalDeposits: (poolData as any).total_deposits.toNumber() / 1e6,
            totalBorrowed: (poolData as any).total_borrowed.toNumber() / 1e6,
            availableLiquidity:
              ((poolData as any).total_deposits.toNumber() - (poolData as any).total_borrowed.toNumber()) / 1e6,
            interestRateBps: (poolData as any).interest_rate_bps,
            maxLtvBps: (poolData as any).max_ltv_bps,
            liquidationThresholdBps: (poolData as any).liquidation_threshold_bps,
            resolved: (oracleData as any).resolved,
            outcome: (oracleData as any).outcome,
            endDate: (cfg.slug ? liveEndDates.current.get(cfg.slug) : null) ?? null,
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
          // Skip markets that fail to decode (old format)
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
    await fetchPolyPrices();
    await discoverMarkets();
  }, [fetchPolyPrices, discoverMarkets]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { markets, loading, refresh };
}
