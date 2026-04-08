import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const idlJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../target/idl/vero.json"), "utf-8")
);
const PROGRAM_ID = new PublicKey(idlJson.address);

function loadKeypair(filepath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function findPoolPda(usdcMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), usdcMint.toBuffer()],
    PROGRAM_ID
  );
}
function findVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()],
    PROGRAM_ID
  );
}
function findOraclePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), mint.toBuffer()],
    PROGRAM_ID
  );
}
function findLenderPositionPda(pool: PublicKey, lender: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()],
    PROGRAM_ID
  );
}

const MARKETS = [
  { name: "BTC above $150k by Dec 2026", probability: 6200, seedLiquidity: 2000, userTokens: 500 },
  { name: "Fed cuts rates in Q3 2026",   probability: 7800, seedLiquidity: 3000, userTokens: 800 },
  { name: "ETH flips SOL market cap",    probability: 2500, seedLiquidity: 1500, userTokens: 300 },
  { name: "Solana TPS exceeds 100k",     probability: 8500, seedLiquidity: 5000, userTokens: 1000 },
  { name: "US passes stablecoin bill",   probability: 9100, seedLiquidity: 4000, userTokens: 600 },
];

async function main() {
  const rpcUrl = process.env.HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const admin = loadKeypair(
    process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`
  );

  console.log("Admin:", admin.publicKey.toBase58());
  const bal = await connection.getBalance(admin.publicKey);
  console.log("Balance:", bal / 1e9, "SOL");

  if (bal < 1_000_000_000) {
    console.log("Low balance — requesting airdrop...");
    const sig = await connection.requestAirdrop(admin.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);
    console.log("Airdropped 2 SOL");
  }

  const wallet = {
    publicKey: admin.publicKey,
    signTransaction: async (tx: any) => { tx.partialSign(admin); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach((tx) => tx.partialSign(admin)); return txs; },
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const program = new Program(idlJson as Idl, provider);

  // Create a single USDC mint shared across all pools
  console.log("\n--- Creating shared USDC mint ---");
  const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("USDC Mint:", usdcMint.toBase58());

  const results: any[] = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const market = MARKETS[i];
    console.log(`\n=== Market ${i + 1}: ${market.name} ===`);

    // Create prediction token mint
    const predMint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log("  Prediction Mint:", predMint.toBase58());

    // Initialize pool
    const [pool] = findPoolPda(usdcMint);

    // Each market needs its own USDC mint to get a unique pool PDA
    // So we create per-market USDC mints (they all represent "USDC" in our demo)
    const marketUsdcMint = i === 0 ? usdcMint : await createMint(connection, admin, admin.publicKey, null, 6);
    const [marketPool] = findPoolPda(marketUsdcMint);
    const [marketVault] = findVaultPda(marketPool);

    console.log("  Pool:", marketPool.toBase58());

    await program.methods
      .initializePool(500, 500, 5000, 6500)
      .accounts({
        authority: admin.publicKey,
        usdcMint: marketUsdcMint,
        pool: marketPool,
        vault: marketVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Initialize oracle
    const [oracle] = findOraclePda(predMint);
    await program.methods
      .initializeOracle(market.probability, new BN(0))
      .accounts({
        authority: admin.publicKey,
        marketMint: predMint,
        oracle,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("  Oracle at", market.probability / 100, "%");

    // Seed liquidity
    const adminUsdc = await createAccount(connection, admin, marketUsdcMint, admin.publicKey);
    await mintTo(connection, admin, marketUsdcMint, adminUsdc, admin, market.seedLiquidity * 1_000_000);

    const [lenderPos] = findLenderPositionPda(marketPool, admin.publicKey);
    await program.methods
      .deposit(new BN(market.seedLiquidity * 1_000_000))
      .accounts({
        lender: admin.publicKey,
        pool: marketPool,
        lenderPosition: lenderPos,
        usdcMint: marketUsdcMint,
        lenderUsdc: adminUsdc,
        vault: marketVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("  Seeded", market.seedLiquidity, "USDC");

    // Mint prediction tokens to admin for borrowing
    const adminPred = await createAccount(connection, admin, predMint, admin.publicKey);
    await mintTo(connection, admin, predMint, adminPred, admin, market.userTokens * 1_000_000);
    console.log("  Minted", market.userTokens, "prediction tokens");

    results.push({
      name: market.name,
      probability: market.probability,
      usdcMint: marketUsdcMint.toBase58(),
      predictionMint: predMint.toBase58(),
      pool: marketPool.toBase58(),
      oracle: oracle.toBase58(),
      adminUsdcAta: adminUsdc.toBase58(),
      adminPredAta: adminPred.toBase58(),
      seedLiquidity: market.seedLiquidity,
    });
  }

  // Save config
  const configPath = path.join(__dirname, "../app/app/markets.json");
  fs.writeFileSync(configPath, JSON.stringify(results, null, 2));

  console.log("\n========================================");
  console.log("  5 MARKETS INITIALIZED ON DEVNET");
  console.log("========================================\n");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}`);
    console.log(`   Probability: ${r.probability / 100}%  |  Liquidity: $${r.seedLiquidity}`);
    console.log(`   USDC Mint: ${r.usdcMint}`);
    console.log(`   Prediction Mint: ${r.predictionMint}`);
    console.log("");
  });
  console.log(`Config saved to ${configPath}`);
}

main().catch(console.error);
