/**
 * DEPRECATED — use the Vite app (`npm run dev`). This file required PRIVATE_KEY
 * and guessed the indexer URL. Product path: src/ + Vite proxy to
 * https://stake.arcium.com/api/stake-indexing
 */
 *
 * WHY THIS IS TRICKY
 * ──────────────────
 * Each claim requires two epoch-specific values from Arcium's server:
 *   • stake_offset (u128)  — your staked balance at that epoch's snapshot
 *   • proof (bytes[])      — inclusion/Merkle proof of your stake
 *
 * These come from Arcium's backend. To get them:
 *
 *  STEP 1 ▶ Open https://staking.arcium.com in Chrome
 *  STEP 2 ▶ Open DevTools → Network tab → filter "XHR" or "Fetch"
 *  STEP 3 ▶ Click the "Claim" button on one epoch
 *  STEP 4 ▶ Find the API request (probably /proof, /claim, or /reward)
 *           Copy the full URL + any auth headers (Bearer token, etc.)
 *  STEP 5 ▶ Fill in ARCIUM_API_BASE and ARCIUM_API_HEADERS below
 *  STEP 6 ▶ Run this script
 *
 * WHAT THE SCRIPT DOES
 * ─────────────────────
 * For each unclaimed epoch (352+1 → current):
 *   1. Fetches proof + stake_offset from Arcium's API
 *   2. Builds the raw claim instruction (accounts exactly matching the tx)
 *   3. Packs up to BATCH_SIZE instructions into one transaction
 *   4. Sends and confirms before moving to next batch
 *
 * KNOWN ACCOUNTS (from tx 3Bb76g...)
 * ────────────────────────────────────
 *   #1  Signer / FEE PAYER      — your wallet
 *   #2  Destination             — your wallet (receives SOL rewards)
 *   #3  Primary Acc Owner       — ApvPuhoKXXfGgCw9WDCfNXhS38Yszf6FpS2wP2SMfmou
 *   #4  Primary Stake Account   — EC3S72DiboNqd6dxdB6acxxqv7sGJXiEU4NK3Dn95U5T
 *   #5  Delegated Stake Account — 7Jd9JeE3J3s3RMnRUNnDvLUiqrvSGk9k6vzgbzoXJPG1
 *   #6  Pool Account            — 2koaNRgmuzpXJTeCiBgZstaqDe6Kb9JuC26mS6d1ztZ4
 *   #7  Clock (Arcium custom)   — 7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot
 *   #8  System Program
 *
 * INSTALL
 * ────────
 *   npm install @solana/web3.js @coral-xyz/anchor bs58 borsh dotenv node-fetch
 *   npx ts-node arcium_batch_claim.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import * as borsh from "borsh";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  "ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq"
);

// Known static accounts from your reference transaction
const PRIMARY_ACC_OWNER  = new PublicKey("ApvPuhoKXXfGgCw9WDCfNXhS38Yszf6FpS2wP2SMfmou");
const PRIMARY_STAKE_ACCT = new PublicKey("EC3S72DiboNqd6dxdB6acxxqv7sGJXiEU4NK3Dn95U5T");
const DELEGATED_STAKE    = new PublicKey("7Jd9JeE3J3s3RMnRUNnDvLUiqrvSGk9k6vzgbzoXJPG1");
const POOL_ACCOUNT       = new PublicKey("2koaNRgmuzpXJTeCiBgZstaqDe6Kb9JuC26mS6d1ztZ4");
const ARCIUM_CLOCK       = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");

// ─── CONFIG YOU MUST FILL IN ───────────────────────────────────────────────────

/**
 * The Arcium staking API base URL.
 * Find this by intercepting the network call when you click "Claim" in the portal.
 * It's probably something like: https://staking.arcium.com/api
 * Or: https://api.arcium.com/staking
 */
const ARCIUM_API_BASE = "https://FILL_IN_FROM_DEVTOOLS";

/**
 * Any auth headers the API requires.
 * Check the "Headers" tab of the request in DevTools.
 * Common: { "Authorization": "Bearer <JWT_TOKEN>" }
 * The JWT usually comes from your wallet signature — check the portal's login flow.
 */
const ARCIUM_API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  // "Authorization": "Bearer YOUR_JWT_TOKEN",
};

/** Your wallet secret key (base58). Put this in .env, not in code. */
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

/** Solana RPC endpoint */
const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";

/**
 * Your last claimed epoch (visible in the portal = 352).
 * Script will claim 353 → CURRENT_FINALIZED_EPOCH.
 */
const LAST_CLAIMED_EPOCH = 352;

/**
 * Current epoch - 1 (the last *finalized* epoch with confirmed rewards).
 * Update this each time you run the script.
 * Current epoch is 429, so finalized = 428.
 */
const CURRENT_FINALIZED_EPOCH = 428;

/**
 * How many claim instructions to pack into one transaction.
 * Each instruction = ~500–700 bytes of accounts + instruction data.
 * Solana tx limit = 1232 bytes total. Start at 3, raise to 5 if it works.
 */
const BATCH_SIZE = 3;

// ─── INSTRUCTION DISCRIMINATOR ─────────────────────────────────────────────────
//
// For Anchor programs, the discriminator is sha256("global:<instruction_name>")[0..8].
// Instruction: claim_delegated_stake_rewards
// 
// You can verify this by decoding the raw instruction data from your reference tx:
//   solana transaction 3Bb76gLkoGvkF... --output json | jq -r
//     '.transaction.message.instructions[2].data' | base64 -d | xxd | head -1
//
// Or compute it:
import { createHash } from "crypto";

function getDiscriminator(name: string): Buffer {
  return Buffer.from(
    createHash("sha256")
      .update(`global:${name}`)
      .digest()
      .slice(0, 8)
  );
}

const CLAIM_DISCRIMINATOR = getDiscriminator("claim_delegated_stake_rewards");

// ─── PROOF FETCHING ────────────────────────────────────────────────────────────

interface EpochProof {
  epoch: number;
  stake_offset: bigint;   // u128
  proof: number[][];      // array of 32-byte arrays (Merkle proof path)
}

/**
 * Fetch proof data for a single epoch from Arcium's API.
 *
 * ADAPT THIS FUNCTION after inspecting the DevTools network call.
 * The endpoint, method, and response shape below are guesses — adjust
 * to match what you actually see in the network tab.
 *
 * Common patterns:
 *   GET  /proof?wallet=<wallet>&epoch=<epoch>
 *   POST /claim { wallet: "...", epoch: N }
 *   GET  /reward/<wallet>/<epoch>
 */
async function fetchEpochProof(epoch: number, wallet: PublicKey): Promise<EpochProof> {
  // ──────────────────────────────────────────────────────────────────────────────
  // CHANGE THIS URL to match what you see in DevTools
  // ──────────────────────────────────────────────────────────────────────────────
  const url = `${ARCIUM_API_BASE}/proof?wallet=${wallet.toBase58()}&epoch=${epoch}`;

  const res = await fetch(url, {
    method: "GET",
    headers: ARCIUM_API_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`API error for epoch ${epoch}: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;

  // ──────────────────────────────────────────────────────────────────────────────
  // CHANGE THESE field names to match the actual API response keys
  // ──────────────────────────────────────────────────────────────────────────────
  return {
    epoch,
    stake_offset: BigInt(data.stake_offset ?? data.stakeOffset ?? data.offset),
    proof:        data.proof ?? data.merkle_proof ?? data.inclusion_proof,
  };
}

// ─── INSTRUCTION BUILDER ───────────────────────────────────────────────────────

/**
 * Encode instruction data for claim_delegated_stake_rewards.
 *
 * From the screenshot, the instruction data has:
 *   • discriminator (8 bytes)
 *   • stake_offset: u128 (16 bytes, little-endian)
 *   • proof: Vec<[u8; 32]>  (4-byte length prefix + N×32 bytes)
 *
 * This matches Anchor's standard borsh encoding.
 */
function encodeClaimData(stake_offset: bigint, proof: number[][]): Buffer {
  const disc = CLAIM_DISCRIMINATOR;                          // 8 bytes

  // u128 as little-endian 16 bytes
  const offsetBuf = Buffer.alloc(16);
  let tmp = stake_offset;
  for (let i = 0; i < 16; i++) {
    offsetBuf[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }

  // Vec<[u8; 32]> — 4-byte LE length + 32 bytes per element
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proof.length, 0);
  const proofBytes = Buffer.concat(proof.map((p) => Buffer.from(p)));

  return Buffer.concat([disc, offsetBuf, proofLen, proofBytes]);
}

function buildClaimInstruction(
  wallet: PublicKey,
  epochProof: EpochProof
): TransactionInstruction {
  const accounts: AccountMeta[] = [
    { pubkey: wallet,            isSigner: true,  isWritable: true  }, // #1 Signer
    { pubkey: wallet,            isSigner: true,  isWritable: true  }, // #2 Destination
    { pubkey: PRIMARY_ACC_OWNER, isSigner: false, isWritable: false }, // #3
    { pubkey: PRIMARY_STAKE_ACCT,isSigner: false, isWritable: true  }, // #4
    { pubkey: DELEGATED_STAKE,   isSigner: false, isWritable: true  }, // #5
    { pubkey: POOL_ACCOUNT,      isSigner: false, isWritable: true  }, // #6
    { pubkey: ARCIUM_CLOCK,      isSigner: false, isWritable: true  }, // #7
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // #8
  ];

  const data = encodeClaimData(epochProof.stake_offset, epochProof.proof);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: accounts,
    data,
  });
}

// ─── BATCH SENDER ──────────────────────────────────────────────────────────────

async function sendBatch(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[],
  epochRange: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey });

  // Compute budget — scale up with batch size
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 * instructions.length })
  );
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })
  );

  for (const ix of instructions) tx.add(ix);

  console.log(
    `  Sending epochs ${epochRange} (${instructions.length} ix, ${tx.serialize().length} bytes)...`
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
    commitment: "confirmed",
    maxRetries: 5,
  });

  return sig;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");
  const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  const connection = new Connection(RPC_URL, "confirmed");

  const epochs = Array.from(
    { length: CURRENT_FINALIZED_EPOCH - LAST_CLAIMED_EPOCH },
    (_, i) => LAST_CLAIMED_EPOCH + 1 + i
  );

  console.log(`\nWallet   : ${wallet.publicKey.toBase58()}`);
  console.log(`Program  : ${PROGRAM_ID.toBase58()}`);
  console.log(`Epochs   : ${epochs[0]} → ${epochs[epochs.length - 1]} (${epochs.length} total)\n`);

  // 1. Fetch all proofs first (fail fast if API is wrong)
  console.log("Fetching epoch proofs from Arcium API...");
  const proofs: EpochProof[] = [];

  for (const epoch of epochs) {
    try {
      const proof = await fetchEpochProof(epoch, wallet.publicKey);
      proofs.push(proof);
      process.stdout.write(`  ✓ epoch ${epoch}\r`);
    } catch (err: any) {
      console.error(`\n  ✗ Failed to fetch proof for epoch ${epoch}: ${err.message}`);
      throw err;
    }
    await new Promise((r) => setTimeout(r, 100)); // gentle on the API
  }
  console.log(`\nFetched ${proofs.length} proofs.\n`);

  // 2. Build all instructions
  const instructions = proofs.map((p) => buildClaimInstruction(wallet.publicKey, p));

  // 3. Send in batches
  const numBatches = Math.ceil(instructions.length / BATCH_SIZE);
  console.log(`Sending ${numBatches} transactions (batch size = ${BATCH_SIZE})...\n`);

  let claimed = 0;
  for (let i = 0; i < instructions.length; i += BATCH_SIZE) {
    const batch = instructions.slice(i, i + BATCH_SIZE);
    const batchEpochs = proofs.slice(i, i + BATCH_SIZE);
    const epochRange = `${batchEpochs[0].epoch}–${batchEpochs[batchEpochs.length - 1].epoch}`;

    let sig: string | undefined;
    let batchSize = batch.length;

    while (batchSize > 0) {
      try {
        sig = await sendBatch(
          connection, wallet,
          instructions.slice(i, i + batchSize),
          epochRange
        );
        break;
      } catch (err: any) {
        if (
          (err.message?.includes("too large") || err.message?.includes("Transaction too large")) &&
          batchSize > 1
        ) {
          batchSize = Math.floor(batchSize / 2);
          console.log(`  ↓ Tx too large — retrying with ${batchSize} instructions`);
        } else {
          throw err;
        }
      }
    }

    claimed += batchSize;
    console.log(`  ✓ https://solscan.io/tx/${sig}`);
    console.log(`  Progress: ${claimed}/${instructions.length} epochs claimed\n`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n✅ All ${claimed} epochs claimed successfully.`);
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
