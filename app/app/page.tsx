"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ArrowUpRight, ArrowDownLeft, AlertTriangle, Search, Wallet, Landmark, ExternalLink, Clock,
} from "lucide-react";
import { useVero } from "./hooks/useVero";
import { useMarkets, Market } from "./hooks/useMarkets";
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q ? markets.filter((m) => m.name.toLowerCase().includes(q)) : markets;
    // Active markets first, then grace period, then expired
    return [...list].sort((a, b) => {
      const ta = timeRemaining(a.endDate);
      const tb = timeRemaining(b.endDate);
      if (ta.expired !== tb.expired) return ta.expired ? 1 : -1;
      return 0;
    });
  }, [markets, search]);

  const totalDeposits = markets.reduce((s, m) => s + m.totalDeposits, 0);
  const totalBorrowed = markets.reduce((s, m) => s + m.totalBorrowed, 0);

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
                placeholder="Search markets..."
                className="w-full h-8 bg-card rounded-lg border border-border pl-8 pr-3 text-[13px] text-text-primary placeholder:text-text-disabled focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] outline-none transition-[color,box-shadow]"
              />
            </div>
            <span className="text-[11px] text-text-disabled shrink-0">{filtered.length} markets</span>
          </div>

          {marketsLoading ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-[13px] text-text-tertiary">Discovering markets...</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {filtered.map((m) => (
                <MarketCard
                  key={m.poolAddress.toBase58() + m.predictionMint.toBase58()}
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

// === Helpers ===

const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000; // 48 hours

function timeRemaining(endDate: string | null): { label: string; expired: boolean; inGracePeriod: boolean } {
  if (!endDate) return { label: "", expired: false, inGracePeriod: false };
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = end - now;

  if (diff <= 0) {
    const graceDiff = end + GRACE_PERIOD_MS - now;
    if (graceDiff <= 0) return { label: "Closed", expired: true, inGracePeriod: false };
    const h = Math.floor(graceDiff / 3_600_000);
    const min = Math.floor((graceDiff % 3_600_000) / 60_000);
    return { label: `${h}h ${min}m to repay`, expired: true, inGracePeriod: true };
  }

  const days = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const min = Math.floor((diff % 3_600_000) / 60_000);

  if (days > 0) return { label: `${days}d ${h}h left`, expired: false, inGracePeriod: false };
  if (h > 0) return { label: `${h}h ${min}m left`, expired: false, inGracePeriod: false };
  return { label: `${min}m left`, expired: false, inGracePeriod: false };
}

// === Market Card (Square) ===

function MarketCard({ market: m, onLend, onBorrow }: {
  market: Market; onLend: () => void; onBorrow: () => void;
}) {
  const yes = m.probabilityBps / 100;
  const no = 100 - yes;
  const tr = timeRemaining(m.endDate);

  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-4 flex flex-col justify-between aspect-square transition-all duration-200 ease-out hover:scale-[1.03] hover:shadow-[0_8px_24px_rgba(61,40,40,0.08)] hover:z-10",
      tr.expired && !tr.inGracePeriod && "opacity-50 hover:scale-100 hover:shadow-none",
    )}>
      <div>
        {m.resolved && (
          <span className="text-[10px] text-warning font-medium block mb-1">RESOLVED</span>
        )}
        {tr.inGracePeriod && (
          <span className="text-[10px] text-warning font-medium block mb-1">GRACE PERIOD</span>
        )}
        <a
          href={m.polymarketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-semibold text-text-primary leading-snug line-clamp-2 mb-2 block hover:text-brand transition-colors"
        >
          {m.name}
          <ExternalLink className="size-2.5 inline ms-1 -mt-0.5 opacity-40" />
        </a>

        {tr.label && (
          <div className={cn(
            "flex items-center gap-1 text-[10px] font-medium mb-2",
            tr.expired ? "text-destructive" : "text-text-tertiary",
          )}>
            <Clock className="size-2.5" />
            {tr.label}
          </div>
        )}

        {/* Yes / No bar */}
        <div className="flex gap-0.5 h-1.5 mb-1.5">
          <div className="bg-success rounded-full" style={{ width: `${yes}%` }} />
          <div className="bg-destructive/40 rounded-full" style={{ width: `${no}%` }} />
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-success font-semibold">Yes {yes.toFixed(2)}%</span>
          <span className="text-destructive font-medium">No {no.toFixed(2)}%</span>
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
          <button onClick={onLend} disabled={tr.expired && !tr.inGracePeriod} className="flex-1 h-7 rounded-lg bg-secondary text-[11px] font-semibold text-text-primary flex items-center justify-center gap-1 transition-colors active:bg-surface-muted disabled:opacity-40 disabled:pointer-events-none">
            <ArrowDownLeft className="size-3" /> Lend
          </button>
          <button onClick={onBorrow} disabled={tr.expired && !tr.inGracePeriod} className="flex-1 h-7 rounded-lg bg-brand text-[11px] font-semibold text-white flex items-center justify-center gap-1 transition-colors active:bg-brand/85 disabled:opacity-40 disabled:pointer-events-none">
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
          key={m.poolAddress.toBase58() + m.predictionMint.toBase58()}
          market={m}
        />
      ))}
    </div>
  );
}

function PositionCard({ market: m }: { market: Market }) {
  const { fetchLenderPosition, fetchBorrowPosition, connected } = useVero(m.usdcMint, m.predictionMint);
  const [lenderPos, setLenderPos] = useState<any>(null);
  const [borrowPos, setBorrowPos] = useState<any>(null);

  // Random but stable health factor per market
  const health = useMemo(() => {
    const seed = m.poolAddress.toBase58().charCodeAt(0) + m.predictionMint.toBase58().charCodeAt(0);
    return 0.4 + ((seed * 7) % 60) / 100 * 1.6;
  }, [m]);

  useEffect(() => {
    if (!connected) return;
    fetchLenderPosition().then(setLenderPos);
    fetchBorrowPosition().then(setBorrowPos);
  }, [connected, fetchLenderPosition, fetchBorrowPosition]);

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
  const {
    connected, deposit, withdraw, borrow, repay,
    fetchPool, fetchOracle, fetchBorrowPosition, fetchLenderPosition,
    usdcBalance, predictionBalance,
  } = useVero(market?.usdcMint, market?.predictionMint);

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
    fetchPool().then(setPool);
    fetchOracle().then(setOracle);
    fetchBorrowPosition().then(setPosition);
    fetchLenderPosition().then(setLenderPos);
  }, [market, mode, fetchPool, fetchOracle, fetchBorrowPosition, fetchLenderPosition]);

  const probability = oracle ? oracle.probabilityBps / 100 : market ? market.probabilityBps / 100 : 0;
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

        {connected && (
          <div className="flex justify-between text-[11px] px-0.5">
            <span className="text-text-disabled">
              {isLendMode || tab === "repay" ? "USDC" : "Tokens"}
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
