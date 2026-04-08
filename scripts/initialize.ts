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

function findLenderPositionPda(
  pool: PublicKey,
  lender: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lender"), pool.toBuffer(), lender.toBuffer()],
    PROGRAM_ID
  );
}

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const admin = loadKeypair(
    process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`
  );

  console.log("Admin:", admin.publicKey.toBase58());
  console.log(
    "Balance:",
    (await connection.getBalance(admin.publicKey)) / 1e9,
    "SOL"
  );

  const wallet = {
    publicKey: admin.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(admin);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.partialSign(admin));
      return txs;
    },
  };
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  const program = new Program(idlJson as Idl, provider);

  // Step 1: Create a mock USDC mint (6 decimals)
  console.log("\n--- Creating mock USDC mint ---");
  const usdcMint = await createMint(
    connection,
    admin,
    admin.publicKey,
    null,
    6
  );
  console.log("USDC Mint:", usdcMint.toBase58());

  // Step 2: Create a mock prediction market token mint
  console.log("\n--- Creating mock prediction token mint ---");
  const predictionMint = await createMint(
    connection,
    admin,
    admin.publicKey,
    null,
    6
  );
  console.log("Prediction Mint:", predictionMint.toBase58());

  // Step 3: Initialize the lending pool
  console.log("\n--- Initializing lending pool ---");
  const [pool] = findPoolPda(usdcMint);
  const [vault] = findVaultPda(pool);

  const sig1 = await program.methods
    .initializePool(
      500, // 5% interest
      500, // 5% liquidation bonus
      5000, // 50% max LTV
      6500 // 65% liquidation threshold
    )
    .accounts({
      authority: admin.publicKey,
      usdcMint,
      pool,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();
  console.log("Pool initialized:", sig1);
  console.log("Pool PDA:", pool.toBase58());
  console.log("Vault PDA:", vault.toBase58());

  // Step 4: Initialize the oracle at 75% probability
  console.log("\n--- Initializing oracle at 75% ---");
  const [oracle] = findOraclePda(predictionMint);

  const sig2 = await program.methods
    .initializeOracle(7500, new BN(0))
    .accounts({
      authority: admin.publicKey,
      marketMint: predictionMint,
      oracle,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();
  console.log("Oracle initialized:", sig2);
  console.log("Oracle PDA:", oracle.toBase58());

  // Step 5: Create admin token accounts and seed the pool
  console.log("\n--- Seeding pool with 1000 USDC ---");
  const adminUsdc = await createAccount(
    connection,
    admin,
    usdcMint,
    admin.publicKey
  );
  await mintTo(connection, admin, usdcMint, adminUsdc, admin, 1_000_000_000); // 1000 USDC

  const [lenderPos] = findLenderPositionPda(pool, admin.publicKey);
  const sig3 = await program.methods
    .deposit(new BN(1_000_000_000))
    .accounts({
      lender: admin.publicKey,
      pool,
      lenderPosition: lenderPos,
      usdcMint,
      lenderUsdc: adminUsdc,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();
  console.log("Deposited 1000 USDC:", sig3);

  // Step 6: Mint some prediction tokens to admin for testing borrow
  console.log("\n--- Minting 500 prediction tokens to admin ---");
  const adminPrediction = await createAccount(
    connection,
    admin,
    predictionMint,
    admin.publicKey
  );
  await mintTo(
    connection,
    admin,
    predictionMint,
    adminPrediction,
    admin,
    500_000_000
  ); // 500 tokens

  // Print summary
  console.log("\n========================================");
  console.log("  VERO DEVNET INITIALIZATION COMPLETE");
  console.log("========================================");
  console.log("");
  console.log("Program ID:      ", PROGRAM_ID.toBase58());
  console.log("Admin:           ", admin.publicKey.toBase58());
  console.log("");
  console.log("USDC Mint:       ", usdcMint.toBase58());
  console.log("Prediction Mint: ", predictionMint.toBase58());
  console.log("Pool PDA:        ", pool.toBase58());
  console.log("Vault PDA:       ", vault.toBase58());
  console.log("Oracle PDA:      ", oracle.toBase58());
  console.log("");
  console.log("Admin USDC ATA:       ", adminUsdc.toBase58());
  console.log("Admin Prediction ATA: ", adminPrediction.toBase58());
  console.log("");
  console.log("Pool seeded with 1000 USDC");
  console.log("Oracle set to 75% probability");
  console.log("Admin has 500 prediction tokens for test borrowing");
  console.log("");
  console.log("Use these values in the frontend to test!");
}

main().catch(console.error);
