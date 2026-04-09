"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Droplets } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import marketsConfig from "../markets.json";

export default function FaucetModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { publicKey } = useWallet();
  const [selectedMarket, setSelectedMarket] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const claim = async () => {
    if (!publicKey) return;
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          marketIndex: selectedMarket,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setStatus(`Error: ${data.error}`);
      } else {
        setStatus(`Received 200 USDC + 100 YES + 100 NO tokens for "${data.market}"`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border rounded-xl sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle className="text-[14px] text-text-primary flex items-center gap-2">
            <Droplets className="size-4 text-brand" />
            Devnet Faucet
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Get test tokens to try lending and borrowing. 24h cooldown per wallet.
          </DialogDescription>
        </DialogHeader>

        {!publicKey ? (
          <p className="text-[12px] text-text-secondary text-center py-4">
            Connect your wallet first
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-text-disabled block mb-1">
                Select Market
              </label>
              <select
                value={selectedMarket}
                onChange={(e) => setSelectedMarket(Number(e.target.value))}
                className="w-full h-9 bg-input-background rounded-lg border border-input px-3 text-[12px] text-text-primary outline-none focus:border-ring transition-colors"
              >
                {marketsConfig.map((m: any, i: number) => (
                  <option key={i} value={i}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-surface-subtle rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-text-tertiary">USDC</span>
                <span className="text-text-primary font-medium">200.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-text-tertiary">YES Tokens</span>
                <span className="text-text-primary font-medium">100.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-text-tertiary">NO Tokens</span>
                <span className="text-text-primary font-medium">100.00</span>
              </div>
            </div>

            <Button
              size="sm"
              className="w-full rounded-lg h-9"
              disabled={loading}
              onClick={claim}
            >
              {loading ? "Minting..." : "Claim Tokens"}
            </Button>

            {status && (
              <p
                className={`text-[11px] break-all ${
                  status.startsWith("Error")
                    ? "text-destructive"
                    : "text-success"
                }`}
              >
                {status}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
