"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Droplets } from "lucide-react";
import FaucetModal from "./FaucetModal";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

export default function Navbar() {
  const [faucetOpen, setFaucetOpen] = useState(false);

  return (
    <>
      <header data-slot="navbar" className="sticky top-0 z-50 bg-card/90 backdrop-blur-md border-b border-border">
        <div className="mx-auto max-w-[1100px] px-6 h-11 flex items-center justify-between">
          <Link href="/" className="text-[14px] font-bold text-text-primary tracking-tight">
            vero
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFaucetOpen(true)}
              className="h-7 px-3 rounded-lg bg-brand/10 text-[11px] font-semibold text-brand flex items-center gap-1.5 transition-colors hover:bg-brand/20"
            >
              <Droplets className="size-3" />
              Faucet
            </button>
            <WalletMultiButton />
          </div>
        </div>
      </header>
      <FaucetModal open={faucetOpen} onClose={() => setFaucetOpen(false)} />
    </>
  );
}
