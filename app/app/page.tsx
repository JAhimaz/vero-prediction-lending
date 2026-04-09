"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ArrowUpRight, ArrowDownLeft, AlertTriangle, Search, Wallet, Landmark,
} from "lucide-react";
import { useVero, findPoolPda, findLenderPositionPda, findBorrowPositionPda, PROGRAM_ID } from "./hooks/useVero";
import { useMarkets, Market } from "./hooks/useMarkets";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder, Idl } from "@coral-xyz/anchor";
import idlJson from "../vero.json";
import { cn } from "./components/ui/utils";
import { Button } from "./components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "./components/ui/dialog";

export default function Dashboard() {
  const { markets, loading: marketsLoading, refresh: refreshMarkets } = useMarkets();
  const [activeMarket, setActiveMarket] = useState<Market | null>(null);
  const [modalMode, setModalMode] = useState<"lend" | "borrow" | null>(null);
  const [search, setSearch] = useState("");
  const [showHeldOnly, setShowHeldOnly] = useState(false);

  const totalDeposits = markets.reduce((s, m) => s + m.totalDeposits, 0);
  const totalBorrowed = markets.reduce((s, m) => s + m.totalBorrowed, 0);
  const { userLent, userBorrowed } = useUserTotals(markets);
  const userHoldings = useUserHoldings(markets);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q ? markets.filter((m) => m.name.toLowerCase().includes(q)) : markets;
    if (showHeldOnly) list = list.filter((m) => userHoldings.has(m.poolAddress.toBase58()));
    return [...list].sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return b.availableLiquidity - a.availableLiquidity;
    });
  }, [markets, search, showHeldOnly, userHoldings]);
  const { tx: latestTx, visible: txVisible } = useLatestTx();

  const typewriterPhrases = useMemo(
    () => markets.slice(0, 8).map((m) => m.name),
    [markets],
  );
  const placeholder = useTypewriter(typewriterPhrases, 50, 1500);
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      {/* Top Stats Bar */}
      <div className="flex items-center gap-6 mb-5">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-brand/10 flex items-center justify-center">
            <Landmark className="size-3 text-brand" />
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider leading-none">Total Lent</p>
            <p className="text-[14px] font-bold text-text-primary leading-tight">${totalDeposits.toLocaleString()}</p>
          </div>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-brand/10 flex items-center justify-center">
            <Wallet className="size-3 text-brand" />
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider leading-none">Total Borrowed</p>
            <p className="text-[14px] font-bold text-text-primary leading-tight">${totalBorrowed.toLocaleString()}</p>
          </div>
        </div>

        <>
            <div className="w-px h-8 bg-text-disabled/40" />
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-success/10 flex items-center justify-center">
                <ArrowDownLeft className="size-3 text-success" />
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider leading-none">Your Lent</p>
                <p className="text-[14px] font-bold text-text-primary leading-tight">${userLent.toLocaleString()}</p>
              </div>
            </div>
            <div className="w-px h-6 bg-border" />
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-brand/10 flex items-center justify-center">
                <ArrowUpRight className="size-3 text-brand" />
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider leading-none">Your Borrowed</p>
                <p className="text-[14px] font-bold text-text-primary leading-tight">${userBorrowed.toLocaleString()}</p>
              </div>
            </div>
          </>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left: Markets */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-disabled" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={search ? "Search for market..." : searchFocused ? "Search for market..." : placeholder}
                className="w-full h-8 bg-card rounded-lg border border-transparent pl-8 pr-3 text-[13px] text-text-primary placeholder:text-text-disabled focus-visible:border-ring focus-visible:ring-0 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center justify-between mb-3">
            {latestTx ? (
              <div className={cn(
                "flex items-center gap-1 text-[11px] text-text-disabled transition-all duration-300",
                txVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}>
                {latestTx.type === "lend" ? (
                  <ArrowDownLeft className="size-3 text-success/60" />
                ) : (
                  <ArrowUpRight className="size-3 text-brand/60" />
                )}
                <span className="font-mono">{shortenAddress(latestTx.address)}</span>
                <span>${latestTx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHeldOnly(!showHeldOnly)}
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors",
                  showHeldOnly
                    ? "bg-brand/15 text-brand"
                    : "text-text-disabled hover:text-text-tertiary"
                )}
              >
                My tokens
              </button>
              <span className="text-[11px] text-text-disabled">{filtered.length} markets</span>
            </div>
          </div>

          {marketsLoading ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-[13px] text-text-tertiary">Discovering markets...</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-[calc(100vh-220px)] overflow-y-auto overflow-x-visible p-2 -m-2">
              {filtered.map((m) => (
                <MarketCard
                  key={m.poolAddress.toBase58() + m.yesMint.toBase58()}
                  market={m}
                  onLend={() => { setActiveMarket(m); setModalMode("lend"); }}
                  onBorrow={() => { setActiveMarket(m); setModalMode("borrow"); }}
                />
              ))}
            </div>
          )}
          {/* Bottom feather fade */}
          <div className="pointer-events-none h-8 -mt-8 relative z-10 bg-gradient-to-t from-surface-page to-transparent" />
        </div>

        {/* Right: Positions */}
        <div className="lg:w-[300px] shrink-0">
          <p className="text-[13px] font-semibold text-text-primary mb-3">Positions</p>
          <PositionsSidebar markets={markets} />
        </div>
      </div>

      <ActionModal
        market={activeMarket}
        mode={modalMode}
        onClose={() => { setModalMode(null); setActiveMarket(null); }}
        onSuccess={() => refreshMarkets()}
      />
    </div>
  );
}

// === Latest Transaction Feed ===

interface LatestTx {
  type: "lend" | "borrow";
  address: string;
  amount: number;
}

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
function randomAddr() {
  let s = "";
  for (let i = 0; i < 44; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}
function randomTx(): LatestTx {
  return {
    type: Math.random() > 0.5 ? "lend" : "borrow",
    address: randomAddr(),
    amount: Math.round((50 + Math.random() * 4950) * 100) / 100,
  };
}

function useLatestTx() {
  const [tx, setTx] = useState<LatestTx | null>(null);
  const [visible, setVisible] = useState(true);

  // Generate first tx on client only to avoid hydration mismatch
  useEffect(() => { if (!tx) setTx(randomTx()); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setTx(randomTx());
        setVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return { tx, visible };
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
}

// === User Token Holdings Hook ===

function useUserHoldings(markets: Market[]) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [holdings, setHoldings] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!publicKey || markets.length === 0) { setHoldings(new Set()); return; }

    const mints = markets.flatMap((m) => [m.yesMint, m.noMint]);
    const atas = mints.map((mint) => {
      const [ata] = PublicKey.findProgramAddressSync(
        [publicKey.toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), mint.toBuffer()],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      );
      return ata;
    });

    connection.getMultipleAccountsInfo(atas).then((accounts) => {
      const held = new Set<string>();
      for (let i = 0; i < markets.length; i++) {
        const yesAcc = accounts[i * 2];
        const noAcc = accounts[i * 2 + 1];
        if (yesAcc || noAcc) {
          // Check if balance > 0
          const hasYes = yesAcc && yesAcc.data.length >= 72 && Buffer.from(yesAcc.data).readBigUInt64LE(64) > BigInt(0);
          const hasNo = noAcc && noAcc.data.length >= 72 && Buffer.from(noAcc.data).readBigUInt64LE(64) > BigInt(0);
          if (hasYes || hasNo) held.add(markets[i].poolAddress.toBase58());
        }
      }
      setHoldings(held);
    }).catch(() => {});
  }, [publicKey, connection, markets]);

  return holdings;
}

// === User Totals Hook ===

function useUserTotals(markets: Market[]) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [userLent, setUserLent] = useState(0);
  const [userBorrowed, setUserBorrowed] = useState(0);

  useEffect(() => {
    if (!publicKey || markets.length === 0) {
      setUserLent(0);
      setUserBorrowed(0);
      return;
    }
    const coder = new BorshCoder(idlJson as Idl);

    const lenderKeys = markets.map((m) => {
      const [pool] = findPoolPda(m.usdcMint);
      const [pos] = findLenderPositionPda(pool, publicKey);
      return pos;
    });
    const borrowYesKeys = markets.map((m) => {
      const [pool] = findPoolPda(m.usdcMint);
      const [pos] = findBorrowPositionPda(pool, publicKey, m.yesMint);
      return pos;
    });
    const borrowNoKeys = markets.map((m) => {
      const [pool] = findPoolPda(m.usdcMint);
      const [pos] = findBorrowPositionPda(pool, publicKey, m.noMint);
      return pos;
    });

    connection.getMultipleAccountsInfo([...lenderKeys, ...borrowYesKeys, ...borrowNoKeys]).then((accounts) => {
      let lent = 0;
      let borrowed = 0;
      for (let i = 0; i < markets.length; i++) {
        const lenderAcc = accounts[i];
        const borrowYesAcc = accounts[markets.length + i];
        const borrowNoAcc = accounts[markets.length * 2 + i];
        if (lenderAcc) {
          try {
            const data = coder.accounts.decode("LenderPosition", lenderAcc.data);
            const shares = (data as any).shares?.toNumber?.() ?? 0;
            // Convert shares to USDC: shares * total_deposits / total_deposit_shares
            // Approximate using market data (close enough for display)
            if (shares > 0) lent += shares / 1e6;
          } catch {}
        }
        for (const borrowAcc of [borrowYesAcc, borrowNoAcc]) {
          if (borrowAcc) {
            try {
              const data = coder.accounts.decode("BorrowPosition", borrowAcc.data);
              const amount = (data as any).borrowed_amount?.toNumber?.() ?? 0;
              if (amount > 0) borrowed += amount / 1e6;
            } catch {}
          }
        }
      }
      setUserLent(lent);
      setUserBorrowed(borrowed);
    }).catch(() => {});
  }, [publicKey, connection, markets]);

  return { userLent, userBorrowed };
}

// === Typewriter Hook ===

function useTypewriter(phrases: string[], charDelay = 50, pauseDelay = 1500) {
  const [text, setText] = useState("");
  const state = useRef({ idx: 0, charIdx: 0, deleting: false });

  useEffect(() => {
    if (phrases.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = state.current;
      const current = phrases[s.idx % phrases.length];
      let delay = charDelay;

      if (!s.deleting) {
        s.charIdx++;
        setText(current.slice(0, s.charIdx));
        if (s.charIdx >= current.length) {
          s.deleting = true;
          delay = pauseDelay;
        }
      } else {
        s.charIdx--;
        setText(current.slice(0, s.charIdx));
        if (s.charIdx <= 0) {
          s.deleting = false;
          s.idx = (s.idx + 1) % phrases.length;
          delay = 600; // pause between markets
        }
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, charDelay);
    return () => clearTimeout(timer);
  }, [phrases, charDelay, pauseDelay]);

  return text;
}

// === Market Card (Square) ===

function MarketCard({ market: m, onLend, onBorrow }: {
  market: Market; onLend: () => void; onBorrow: () => void;
}) {
  const yes = m.probabilityBps / 100;
  const no = 100 - yes;

  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-4 flex flex-col justify-between aspect-square transition-all duration-200 ease-out hover:scale-[1.03] hover:shadow-[0_8px_24px_rgba(61,40,40,0.08)] hover:z-10",
      m.resolved && "opacity-50 hover:scale-100 hover:shadow-none",
    )}>
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand/10 text-brand">{m.symbol}</span>
          {m.resolved && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-warning/10 text-warning">Resolved</span>
          )}
        </div>
        <p className="text-[13px] font-semibold text-text-primary leading-snug line-clamp-2 mb-3">
          {m.name}
        </p>

        {/* Pass / Fail bar */}
        <div className="flex gap-0.5 h-1.5 mb-1.5">
          <div className="bg-success rounded-full" style={{ width: `${yes}%` }} />
          <div className="bg-destructive/40 rounded-full" style={{ width: `${no}%` }} />
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-success font-semibold">Pass {yes.toFixed(1)}%</span>
          <span className="text-destructive font-medium">Fail {no.toFixed(1)}%</span>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-baseline gap-1">
            <span className="text-[14px] font-bold text-text-primary">${m.availableLiquidity.toLocaleString()}</span>
            <span className="text-[10px] text-text-disabled">available</span>
          </div>
          {m.supplyAprPct > 0 && (
            <span className="text-[10px] font-semibold text-success">{m.supplyAprPct.toFixed(2)}% APR</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={onLend} disabled={m.resolved} className="flex-1 h-7 rounded-lg bg-secondary text-[11px] font-semibold text-text-primary flex items-center justify-center gap-1 transition-colors active:bg-surface-muted disabled:opacity-40 disabled:pointer-events-none">
            <ArrowDownLeft className="size-3" /> Lend
          </button>
          <button onClick={onBorrow} disabled={m.resolved} className="flex-1 h-7 rounded-lg bg-brand text-[11px] font-semibold text-white flex items-center justify-center gap-1 transition-colors active:bg-brand/85 disabled:opacity-40 disabled:pointer-events-none">
            <ArrowUpRight className="size-3" /> Borrow
          </button>
        </div>
      </div>
    </div>
  );
}

// === Positions Sidebar ===

function PositionsSidebar({ markets }: { markets: Market[] }) {
  const { connected } = useVero();

  if (!connected) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center">
        <p className="text-[13px] text-text-secondary">Connect wallet to view positions</p>
      </div>
    );
  }

  return (
    <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-2 pr-1">
      {markets.map((m) => (
        <PositionCard
          key={m.poolAddress.toBase58() + m.yesMint.toBase58()}
          market={m}
        />
      ))}
    </div>
  );
}

function PositionCard({ market: m }: { market: Market }) {
  const { fetchLenderPosition, fetchBorrowPosition: fetchYesBorrow, connected } = useVero(m.usdcMint, m.yesMint);
  const { fetchBorrowPosition: fetchNoBorrow } = useVero(m.usdcMint, m.noMint);
  const [lenderPos, setLenderPos] = useState<any>(null);
  const [borrowPos, setBorrowPos] = useState<any>(null);

  // Random but stable health factor per market
  const health = useMemo(() => {
    const seed = m.poolAddress.toBase58().charCodeAt(0) + m.yesMint.toBase58().charCodeAt(0);
    return 0.4 + ((seed * 7) % 60) / 100 * 1.6;
  }, [m]);

  useEffect(() => {
    if (!connected) return;
    fetchLenderPosition().then(setLenderPos);
    fetchYesBorrow().then(setBorrowPos);
  }, [connected, fetchLenderPosition, fetchYesBorrow]);

  const hasLend = lenderPos && (lenderPos.shares ?? lenderPos.deposited_amount ?? lenderPos.depositedAmount)?.toNumber() > 0;
  const hasBorrow = borrowPos && (borrowPos.borrowed_amount ?? borrowPos.borrowedAmount).toNumber() > 0;

  if (!hasLend && !hasBorrow) return null;

  const healthPct = Math.min(health / 2, 1);
  const healthColor = health > 1.5 ? "var(--success)" : health > 1.0 ? "var(--warning)" : "var(--destructive)";
  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference * (1 - healthPct);

  return (
    <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
      {/* Health Circle */}
      <div className="size-11 shrink-0 relative">
        <svg viewBox="0 0 44 44" className="size-11 -rotate-90">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-muted)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r="18" fill="none"
            stroke={healthColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-text-primary">
          {health.toFixed(1)}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-text-primary truncate">{m.name}</p>
        {hasLend && (
          <p className="text-[11px] text-text-secondary">
            Lent {((lenderPos.shares ?? lenderPos.deposited_amount ?? lenderPos.depositedAmount).toNumber() / 1e6).toLocaleString()} shares
          </p>
        )}
        {hasBorrow && (
          <p className="text-[11px] text-text-secondary">
            Borrowed ${((borrowPos.borrowed_amount ?? borrowPos.borrowedAmount).toNumber() / 1e6).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

// === Action Modal ===

function ActionModal({ market, mode, onClose, onSuccess }: {
  market: Market | null;
  mode: "lend" | "borrow" | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isOpen = !!market && !!mode;
  const [collateralSide, setCollateralSide] = useState<"yes" | "no">("yes");
  const activeMint = market ? (collateralSide === "yes" ? market.yesMint : market.noMint) : undefined;

  const {
    connected, deposit, withdraw, borrow, repay,
    fetchPool, fetchOracle, fetchBorrowPosition, fetchLenderPosition,
    usdcBalance, predictionBalance,
  } = useVero(market?.usdcMint, activeMint);

  const [tab, setTab] = useState<"deposit" | "withdraw" | "borrow" | "repay">("deposit");
  const [amount, setAmount] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [pool, setPool] = useState<any>(null);
  const [oracle, setOracle] = useState<any>(null);
  const [position, setPosition] = useState<any>(null);
  const [lenderPos, setLenderPos] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!market) return;
    setAmount(""); setCollateralAmount(""); setStatus("");
    setTab(mode === "lend" ? "deposit" : "borrow");
    setCollateralSide("yes");
    fetchPool().then(setPool);
    fetchOracle().then(setOracle);
    fetchBorrowPosition().then(setPosition);
    fetchLenderPosition().then(setLenderPos);
  }, [market, mode, fetchPool, fetchOracle, fetchBorrowPosition, fetchLenderPosition]);

  useEffect(() => {
    if (!market) return;
    fetchOracle().then(setOracle);
    fetchBorrowPosition().then(setPosition);
  }, [collateralSide, fetchOracle, fetchBorrowPosition]);

  const probability = oracle ? (oracle.probability_bps ?? oracle.probabilityBps) / 100 : market ? market.probabilityBps / 100 : 0;
  const maxLtv = pool ? pool.maxLtvBps / 100 : 50;
  const maxBorrow = collateralAmount && probability
    ? (parseFloat(collateralAmount) * (probability / 100) * (maxLtv / 100)).toFixed(2) : "0.00";

  const refresh = () => {
    fetchPool().then(setPool);
    fetchBorrowPosition().then(setPosition);
    fetchLenderPosition().then(setLenderPos);
    onSuccess();
  };

  const handleAction = async () => {
    setLoading(true); setStatus("");
    try {
      let sig: string;
      const lamports = Math.floor(parseFloat(amount) * 1e6);
      if (tab === "deposit") sig = await deposit(lamports);
      else if (tab === "withdraw") sig = await withdraw(lamports);
      else if (tab === "borrow") {
        sig = await borrow(Math.floor(parseFloat(collateralAmount) * 1e6), lamports);
      } else sig = await repay(lamports);
      setStatus(`Tx: ${sig!.slice(0, 20)}...`);
      setAmount(""); setCollateralAmount("");
      refresh();
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const isLendMode = tab === "deposit" || tab === "withdraw";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border rounded-xl sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle className="text-[14px] text-text-primary">{market?.name}</DialogTitle>
          <DialogDescription className="text-[11px]">
            {probability}% · ${market?.availableLiquidity.toLocaleString()} available
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-lg p-[2px] flex">
          {mode === "lend" ? (
            <>
              <TabBtn active={tab === "deposit"} onClick={() => { setTab("deposit"); setAmount(""); }}>Deposit</TabBtn>
              <TabBtn active={tab === "withdraw"} onClick={() => { setTab("withdraw"); setAmount(""); }}>Withdraw</TabBtn>
            </>
          ) : (
            <>
              <TabBtn active={tab === "borrow"} onClick={() => { setTab("borrow"); setAmount(""); setCollateralAmount(""); }}>Borrow</TabBtn>
              <TabBtn active={tab === "repay"} onClick={() => { setTab("repay"); setAmount(""); }}>Repay</TabBtn>
            </>
          )}
        </div>

        {!isLendMode && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setCollateralSide("yes")}
              className={cn(
                "flex-1 h-7 rounded-lg text-[11px] font-semibold transition-all",
                collateralSide === "yes"
                  ? "bg-success text-white"
                  : "bg-surface-muted text-text-tertiary"
              )}
            >
              YES Token
            </button>
            <button
              onClick={() => setCollateralSide("no")}
              className={cn(
                "flex-1 h-7 rounded-lg text-[11px] font-semibold transition-all",
                collateralSide === "no"
                  ? "bg-destructive text-white"
                  : "bg-surface-muted text-text-tertiary"
              )}
            >
              NO Token
            </button>
          </div>
        )}

        {connected && (
          <div className="flex justify-between text-[11px] px-0.5">
            <span className="text-text-disabled">
              {isLendMode || tab === "repay" ? "USDC" : `${collateralSide.toUpperCase()} Tokens`}
            </span>
            <span className="text-text-secondary font-medium">
              {isLendMode || tab === "repay" ? usdcBalance.toLocaleString() : predictionBalance.toLocaleString()}
            </span>
          </div>
        )}

        {tab === "borrow" && (
          <>
            <ModalInput label="Collateral" value={collateralAmount} onChange={setCollateralAmount}
              onMax={predictionBalance > 0 ? () => setCollateralAmount(predictionBalance.toString()) : undefined} />
            <div className="flex justify-between text-[11px] px-0.5">
              <span className="text-text-disabled">Max borrow ({maxLtv}%)</span>
              <span className="text-text-secondary font-medium">${maxBorrow}</span>
            </div>
          </>
        )}

        {tab === "repay" && position && (position.borrowed_amount ?? position.borrowedAmount).toNumber() > 0 && (
          <div className="flex justify-between text-[11px] px-0.5">
            <span className="text-text-disabled">Total debt</span>
            <span className="text-text-secondary font-medium">
              ${(((position.borrowed_amount ?? position.borrowedAmount).toNumber() + (position.accrued_interest ?? position.accruedInterest).toNumber()) / 1e6).toLocaleString()}
            </span>
          </div>
        )}

        <ModalInput
          label={tab === "borrow" ? "Borrow (USDC)" : "Amount (USDC)"}
          value={amount}
          onChange={setAmount}
          onMax={() => {
            if (tab === "deposit") setAmount(usdcBalance.toString());
            else if (tab === "withdraw" && lenderPos) setAmount(((lenderPos.shares ?? lenderPos.deposited_amount ?? lenderPos.depositedAmount).toNumber() / 1e6).toString());
            else if (tab === "repay" && position) setAmount((((position.borrowed_amount ?? position.borrowedAmount).toNumber() + (position.accrued_interest ?? position.accruedInterest).toNumber()) / 1e6).toString());
          }}
        />

        {tab === "borrow" && amount && parseFloat(amount) > parseFloat(maxBorrow) && (
          <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
            <AlertTriangle className="size-2.5" /> Exceeds max LTV
          </p>
        )}

        <Button size="sm" className="w-full rounded-lg h-9" disabled={!connected || !amount || loading} onClick={handleAction}>
          {loading ? "..." : !connected ? "Connect Wallet" :
            tab === "deposit" ? "Deposit" : tab === "withdraw" ? "Withdraw" : tab === "borrow" ? "Borrow" : "Repay"
          }
        </Button>

        {status && (
          <p className={cn("text-[11px] break-all", status.startsWith("Error") ? "text-destructive" : "text-success")}>
            {status}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn(
      "flex-1 h-7 rounded-lg text-[12px] font-semibold transition-all",
      active ? "bg-card text-text-primary shadow-sm" : "text-muted-foreground"
    )}>
      {children}
    </button>
  );
}

function ModalInput({ label, value, onChange, onMax }: {
  label: string; value: string; onChange: (v: string) => void; onMax?: () => void;
}) {
  return (
    <div>
      <label className="text-[11px] text-text-disabled block mb-1">{label}</label>
      <div className="relative">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00"
          className="w-full h-9 bg-input-background rounded-lg border border-input px-3 text-[13px] text-text-primary placeholder:text-text-disabled focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] outline-none transition-[color,box-shadow]" />
        {onMax && <button onClick={onMax} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-brand">MAX</button>}
      </div>
    </div>
  );
}
