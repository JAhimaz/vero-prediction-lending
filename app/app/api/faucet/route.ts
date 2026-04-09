import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

// In-memory rate limit store (resets on server restart)
const lastClaim = new Map<string, number>();
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadAdmin(): Keypair {
  const keyPath = process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadMarkets() {
  const configPath = path.join(process.cwd(), "app", "markets.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

export async function POST(req: Request) {
  try {
    const { wallet, marketIndex } = await req.json();

    if (!wallet || marketIndex === undefined) {
      return NextResponse.json({ error: "Missing wallet or marketIndex" }, { status: 400 });
    }

    const userPubkey = new PublicKey(wallet);
    const markets = loadMarkets();

    if (marketIndex < 0 || marketIndex >= markets.length) {
      return NextResponse.json({ error: "Invalid market index" }, { status: 400 });
    }

    // Rate limit: 24h per wallet
    const key = `${wallet}`;
    const last = lastClaim.get(key) || 0;
    const now = Date.now();
    if (now - last < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (now - last)) / 3_600_000);
      return NextResponse.json(
        { error: `Rate limited. Try again in ~${remaining}h.` },
        { status: 429 }
      );
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const admin = loadAdmin();
    const market = markets[marketIndex];

    const usdcMint = new PublicKey(market.usdcMint);
    const predMint = new PublicKey(market.predictionMint);

    // Mint 200 USDC (200 * 1e6)
    const userUsdc = await getOrCreateAssociatedTokenAccount(
      connection, admin, usdcMint, userPubkey
    );
    await mintTo(connection, admin, usdcMint, userUsdc.address, admin, 200_000_000);

    // Mint 100 prediction tokens (100 * 1e6)
    const userPred = await getOrCreateAssociatedTokenAccount(
      connection, admin, predMint, userPubkey
    );
    await mintTo(connection, admin, predMint, userPred.address, admin, 100_000_000);

    // Update rate limit
    lastClaim.set(key, now);

    return NextResponse.json({
      success: true,
      usdc: 200,
      predictionTokens: 100,
      market: market.name,
    });
  } catch (e: any) {
    console.error("Faucet error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
