"use client";

import { Market } from "../hooks/useMarkets";

export default function MarketSelector({
  markets,
  selected,
  onSelect,
  loading,
}: {
  markets: Market[];
  selected: Market | null;
  onSelect: (m: Market) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 p-6 text-center">
        <p className="text-zinc-500 text-sm">Discovering markets on-chain...</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 p-6 text-center">
        <p className="text-zinc-500 text-sm">No markets found on-chain.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-400">Select a market</p>
      <div className="grid grid-cols-1 gap-2">
        {markets.map((m) => {
          const isSelected = selected?.poolAddress.equals(m.poolAddress) && selected?.yesMint.equals(m.yesMint);
          return (
            <button
              key={m.poolAddress.toBase58() + m.yesMint.toBase58()}
              onClick={() => onSelect(m)}
              className={`w-full rounded-xl border p-4 text-left transition ${
                isSelected
                  ? "border-white bg-zinc-900"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{m.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Probability: {m.probabilityBps / 100}%
                    {m.resolved && (
                      <span className="ml-2 text-yellow-400">
                        Resolved: {m.outcome ? "YES" : "NO"}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white font-medium">
                    ${m.availableLiquidity.toLocaleString()}
                  </p>
                  <p className="text-xs text-zinc-500">available</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
