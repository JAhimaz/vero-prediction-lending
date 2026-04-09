import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
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

function findPoolPda(usdcMint: PublicKey, marketMint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), usdcMint.toBuffer(), marketMint.toBuffer()], PROGRAM_ID);
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

// Real MetaDAO markets discovered from mainnet conditional vault program
// Each entry: question pubkey, underlying symbol, approximate YES probability
const METADAO_MARKETS = [
  { name: "MetaDAO Governance: USDC Treasury Allocation", symbol: "USDC", question: "GCEY6dfRbSAsNprJtnjihQWFMRJywZZAiFHZikrCZeYj", probability: 6200, supply: 522030066 },
  { name: "MetaDAO Governance: Protocol Expansion Vote", symbol: "USDC", question: "6kWdNDkBa8gDFF4smuNPBsPAwYr5ZWFqHXVnjLfPHGVA", probability: 5500, supply: 419842353 },
  { name: "MetaDAO: New Token Listing Proposal", symbol: "USDC", question: "BsV1MpzweR93rABt4LEV9JLhjwxLmLixJN2cA1yaazuv", probability: 7100, supply: 32424581 },
  { name: "JUP Futarchy: Fee Structure Update", symbol: "JUP", question: "FLzTaTC2DSx1p7HwVVm5ZZZBFrghowCfKxD3TEp7YdnS", probability: 5000, supply: 18287717 },
  { name: "MetaDAO: Community Grant Allocation", symbol: "USDC", question: "FTeden9fsxNECio15TTomnoxRi4ZpZMVWiEVmi6kD3x4", probability: 4500, supply: 6701360 },
  { name: "MetaDAO Governance: Staking Rewards", symbol: "USDC", question: "EWWHvian4P7sVnU2acVfzaNkvJyEvbVCUkgYVvPhAiQt", probability: 3800, supply: 3416879 },
  { name: "MetaDAO: Developer Fund Proposal", symbol: "USDC", question: "B5nd4atoUot7ypk5LpfJZ3A7S7WMiEGXFaLHEWAQKFBi", probability: 6800, supply: 1702911 },
  { name: "ORE: Mining Rewards Adjustment", symbol: "ORE", question: "2EfzYWNqXw2eSc4FayQJBpra2w1uWnu1UayqCxnxWpAa", probability: 5200, supply: 1505102 },
  { name: "MetaDAO: Governance Token Burn", symbol: "USDC", question: "8v61hHfP3Lwv83reoEYMTQVhiZDzbqYz9mWxYbGZWdbM", probability: 4200, supply: 1245179 },
  { name: "Rustfully: Protocol Integration Vote", symbol: "RSTFUL", question: "5uABHZoeyKEApcssbbewwdgh2nnbUTgRDYwvYnTD62Yu", probability: 7500, supply: 1027881 },
  { name: "MetaDAO: Liquidity Incentive Program", symbol: "USDC", question: "ByXtDJd2zvSrBbj45A1RARUSSTA2V4UadVMQQPMj1Qeb", probability: 5800, supply: 991872 },
  { name: "MetaDAO: Cross-Chain Bridge Proposal", symbol: "USDC", question: "5UhmGx5MB8YoqgtMEYV4eGvhYrMCg2brwXKbE8Fddxqc", probability: 3500, supply: 837641 },
  { name: "JUP Futarchy: Perps Fee Reduction", symbol: "JUP", question: "9W3W6MR7b3Kb1WoN4TH5ind44BGe6Mayj7hDkTYbp5KV", probability: 6000, supply: 574753 },
  { name: "JUP: Airdrop Distribution Model", symbol: "JUP", question: "GJW5frsyGaqTbE5FrpLtUvPQEgjLnVh2UjLFnZK9Fvxb", probability: 5500, supply: 574753 },
  { name: "JUP: Governance Upgrade Proposal", symbol: "JUP", question: "B5QvhMuS7msUTD83wig2UPmymLRxNKAqRkFnvedv6G4u", probability: 4800, supply: 566119 },
  { name: "MetaDAO: Treasury Diversification", symbol: "USDC", question: "42n94U4KrMsJoJkD5B8rVLuZ2mMmCF2kYqy3KWXsRCJ9", probability: 6500, supply: 528707 },
  { name: "MetaDAO: Emissions Schedule Update", symbol: "USDC", question: "BdnBC3j7Xns8Bz5fZfJN2M8q1C4jCVqFn2R7kVfP3Z9q", probability: 4000, supply: 288581 },
  { name: "MetaDAO: Validator Delegation Policy", symbol: "USDC", question: "E2m6dkMQ3XbZeR7ufN1T3cVhvT8kAKpVo4VfVqN1gMzT", probability: 5700, supply: 217112 },
  { name: "MetaDAO: Marketing Budget Allocation", symbol: "USDC", question: "2NkNhM4DxXfFkCMz8VyP7hQwbT3vF2JxqLnZR5pM3Kib", probability: 3200, supply: 209533 },
  { name: "MetaDAO: Smart Contract Audit Fund", symbol: "USDC", question: "Dy7ZDLovtM89cVrB3KPZ4qjN7bC2FxQ3kVfQGz5Rq2HP", probability: 7800, supply: 182411 },
  { name: "MetaDAO: DAO Tooling Grant", symbol: "USDC", question: "5giGwtvdnqAi3XjQRfB5yT6zPVxQ8KfC2N9bJvP7Qm3H", probability: 5400, supply: 173813 },
];

async function main() {
  const rpcUrl = process.env.HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const admin = loadKeypair(process.env.HOME + "/.config/solana/id.json");

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  const wallet = {
    publicKey: admin.publicKey,
    signTransaction: async (tx: any) => { tx.partialSign(admin); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach((tx) => tx.partialSign(admin)); return txs; },
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const program = new Program(idlJson as Idl, provider);

  const TREASURY = new PublicKey("2NQyirUKxb5MCvVQnae7W5rTk7LXj9BoMhQUHbjuWMzA");
  const results: any[] = [];
  const userWallet = process.argv[2] ? new PublicKey(process.argv[2]) : null;

  // Create a single shared USDC mint for all pools
  console.log("\n--- Creating shared USDC mint ---");
  const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("USDC Mint:", usdcMint.toBase58());

  // Create treasury USDC ATA once (shared across all pools)
  const treasuryUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, TREASURY);
  console.log("Treasury USDC ATA:", treasuryUsdc.address.toBase58());

  // Create admin USDC ATA once
  const adminUsdcAta = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, admin.publicKey);
  // Mint a large USDC supply to admin for seeding all pools
  await mintTo(connection, admin, usdcMint, adminUsdcAta.address, admin, 100_000_000_000); // 100k USDC
  console.log("Admin USDC ATA:", adminUsdcAta.address.toBase58(), "(100,000 USDC)");

  console.log(`\nInitializing ${METADAO_MARKETS.length} MetaDAO markets on devnet...\n`);

  for (let i = 0; i < METADAO_MARKETS.length; i++) {
    const market = METADAO_MARKETS[i];
    console.log(`=== ${i + 1}/${METADAO_MARKETS.length}: ${market.name} ===`);

    // YES + NO mints per market, shared USDC
    const yesMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const noMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const [pool] = findPoolPda(usdcMint, yesMint);
    const [vault] = findVaultPda(pool);

    // Init pool: 0.1% deposit, 0.5% borrow, 5% liquidation
    await program.methods.initializePool(500, 500, 5000, 6500, 10, 50, 500).accounts({
      authority: admin.publicKey, usdcMint, marketMint: yesMint, treasury: TREASURY, pool, vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Init YES oracle
    const [yesOracle] = findOraclePda(yesMint);
    await program.methods.initializeOracle(market.probability, new BN(0)).accounts({
      authority: admin.publicKey, marketMint: yesMint, oracle: yesOracle,
      systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Init NO oracle (probability = 10000 - YES probability)
    const noProbability = 10000 - market.probability;
    const [noOracle] = findOraclePda(noMint);
    await program.methods.initializeOracle(noProbability, new BN(0)).accounts({
      authority: admin.publicKey, marketMint: noMint, oracle: noOracle,
      systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Seed liquidity scaled by real supply
    const seedAmount = Math.max(1000, Math.min(10000, Math.round(market.supply / 100000)));
    const [lenderPos] = findLenderPositionPda(pool, admin.publicKey);
    await program.methods.deposit(new BN(seedAmount * 1_000_000)).accounts({
      lender: admin.publicKey, pool, lenderPosition: lenderPos, usdcMint,
      lenderUsdc: adminUsdcAta.address, vault, treasuryUsdc: treasuryUsdc.address,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([admin]).rpc();

    // Mint YES + NO tokens to admin
    const adminYes = await createAccount(connection, admin, yesMint, admin.publicKey);
    await mintTo(connection, admin, yesMint, adminYes, admin, 2000_000_000);
    const adminNo = await createAccount(connection, admin, noMint, admin.publicKey);
    await mintTo(connection, admin, noMint, adminNo, admin, 2000_000_000);

    console.log(`  ${market.symbol} | Pass ${market.probability / 100}% / Fail ${noProbability / 100}% | $${seedAmount} liquidity`);

    // Mint to user wallet if provided
    if (userWallet && i === 0) {
      // Mint USDC to user wallet once (shared mint)
      const userUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, userWallet);
      await mintTo(connection, admin, usdcMint, userUsdc.address, admin, 10000_000_000);
      const userYes = await getOrCreateAssociatedTokenAccount(connection, admin, yesMint, userWallet);
      await mintTo(connection, admin, yesMint, userYes.address, admin, 2000_000_000);
      const userNo = await getOrCreateAssociatedTokenAccount(connection, admin, noMint, userWallet);
      await mintTo(connection, admin, noMint, userNo.address, admin, 2000_000_000);
    }

    results.push({
      name: market.name,
      symbol: market.symbol,
      metadaoQuestion: market.question,
      probabilityBps: market.probability,
      usdcMint: usdcMint.toBase58(),
      yesMint: yesMint.toBase58(),
      noMint: noMint.toBase58(),
      pool: pool.toBase58(),
      yesOracle: yesOracle.toBase58(),
      noOracle: noOracle.toBase58(),
      seedLiquidity: seedAmount,
    });
  }

  const configPath = path.join(__dirname, "../app/app/markets.json");
  fs.writeFileSync(configPath, JSON.stringify(results, null, 2));

  console.log("\n========================================");
  console.log("  METADAO MARKETS ON DEVNET");
  console.log("========================================\n");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}`);
    console.log(`   ${r.symbol} | ${r.probabilityBps / 100}% | $${r.seedLiquidity}`);
    console.log();
  });
  console.log(`Config saved to ${configPath}`);
}

main().catch(console.error);
