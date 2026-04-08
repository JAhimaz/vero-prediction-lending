import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const idlJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../target/idl/vero.json"), "utf-8")
);
const PROGRAM_ID = new PublicKey(idlJson.address);

function loadKeypair(filepath: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(filepath, "utf-8")))
  );
}

function findPoolPda(usdcMint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), usdcMint.toBuffer()], PROGRAM_ID);
}
function findVaultPda(pool: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID);
}
function findOraclePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle"), mint.toBuffer()], PROGRAM_ID);
}
function findLenderPositionPda(pool: PublicKey, lender: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()], PROGRAM_ID);
}

async function main() {
  const rpcUrl = process.env.HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const admin = loadKeypair(process.env.HOME + "/.config/solana/id.json");

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  // Fetch real Polymarket markets
  console.log("\nFetching live Polymarket markets...");
  const res = await fetch(
    "https://gamma-api.polymarket.com/markets?limit=50&active=true&order=volume24hr&ascending=false"
  );
  const allMarkets = await res.json();

  const polymarkets = allMarkets
    .map((m: any) => {
      const prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices || [];
      const yes = parseFloat(prices[0] || "0");
      if (yes > 0.97 || yes < 0.03) return null;
      const events = m.events || [];
      const eventSlug = events.length > 0 ? events[0].slug : m.slug;
      return {
        question: m.question,
        slug: m.slug,
        eventSlug,
        polymarketUrl: `https://polymarket.com/event/${eventSlug}`,
        yesBps: Math.round(yes * 10000),
        volume24hr: Math.round(parseFloat(m.volume24hr || "0")),
      };
    })
    .filter(Boolean)
    .filter((m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.question === m.question) === i)
    .slice(0, 10);

  console.log(`Found ${polymarkets.length} markets to create:\n`);
  polymarkets.forEach((m: any, i: number) => console.log(`  ${i + 1}. ${m.question} (${m.yesBps / 100}%)`));

  const wallet = {
    publicKey: admin.publicKey,
    signTransaction: async (tx: any) => { tx.partialSign(admin); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach((tx) => tx.partialSign(admin)); return txs; },
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const program = new Program(idlJson as Idl, provider);

  const results: any[] = [];
  const userWallet = process.argv[2] ? new PublicKey(process.argv[2]) : null;

  for (let i = 0; i < polymarkets.length; i++) {
    const pm = polymarkets[i];
    console.log(`\n=== ${i + 1}/${polymarkets.length}: ${pm.question} ===`);

    // Each market gets its own USDC mint (devnet demo) and prediction mint
    const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const predMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const [pool] = findPoolPda(usdcMint);
    const [vault] = findVaultPda(pool);

    // Init pool
    await program.methods.initializePool(500, 500, 5000, 6500).accounts({
      authority: admin.publicKey, usdcMint, pool, vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Init oracle with real Polymarket probability
    const [oracle] = findOraclePda(predMint);
    await program.methods.initializeOracle(pm.yesBps, new BN(0)).accounts({
      authority: admin.publicKey, marketMint: predMint, oracle,
      systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Seed liquidity based on volume (scaled down)
    const seedAmount = Math.max(1000, Math.min(10000, Math.round(pm.volume24hr / 10000)));
    const adminUsdc = await createAccount(connection, admin, usdcMint, admin.publicKey);
    await mintTo(connection, admin, usdcMint, adminUsdc, admin, seedAmount * 1_000_000);
    const [lenderPos] = findLenderPositionPda(pool, admin.publicKey);
    await program.methods.deposit(new BN(seedAmount * 1_000_000)).accounts({
      lender: admin.publicKey, pool, lenderPosition: lenderPos, usdcMint,
      lenderUsdc: adminUsdc, vault, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Mint prediction tokens to admin
    const adminPred = await createAccount(connection, admin, predMint, admin.publicKey);
    await mintTo(connection, admin, predMint, adminPred, admin, 2000_000_000);

    console.log(`  Oracle: ${pm.yesBps / 100}% | Liquidity: $${seedAmount}`);

    // Mint tokens to user wallet if provided
    if (userWallet) {
      const { getOrCreateAssociatedTokenAccount } = await import("@solana/spl-token");
      const userUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, userWallet);
      await mintTo(connection, admin, usdcMint, userUsdc.address, admin, 5000_000_000);
      const userPred = await getOrCreateAssociatedTokenAccount(connection, admin, predMint, userWallet);
      await mintTo(connection, admin, predMint, userPred.address, admin, 2000_000_000);
      console.log(`  Minted 5000 USDC + 2000 tokens to ${userWallet.toBase58().slice(0, 8)}...`);
    }

    results.push({
      name: pm.question,
      slug: pm.slug,
      polymarketUrl: pm.polymarketUrl,
      probabilityBps: pm.yesBps,
      usdcMint: usdcMint.toBase58(),
      predictionMint: predMint.toBase58(),
      pool: pool.toBase58(),
      oracle: oracle.toBase58(),
      seedLiquidity: seedAmount,
    });
  }

  // Save config
  const configPath = path.join(__dirname, "../app/app/markets.json");
  fs.writeFileSync(configPath, JSON.stringify(results, null, 2));

  console.log("\n========================================");
  console.log("  REAL POLYMARKET MARKETS ON DEVNET");
  console.log("========================================\n");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}`);
    console.log(`   ${r.polymarketUrl}`);
    console.log(`   Yes: ${r.probabilityBps / 100}% | Liquidity: $${r.seedLiquidity}`);
    console.log();
  });
  console.log(`Config saved to ${configPath}`);
}

main().catch(console.error);
