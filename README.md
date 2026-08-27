# Arcium Batch Claim

Unofficial community helper for leftover **delegated-stake** rewards on Arcium. Not affiliated with Arcium. MIT so anyone can read what the page actually signs. No custody: you look up an address, then a Wallet Standard wallet (Phantom, Solflare, Backpack) signs. There is no private-key / CLI path.

## What it is for

Arcium records leftover SOL rewards **per epoch**, with a last-claimed cursor on each delegated position. The official portal still tends to walk those epochs one click at a time. After you undelegate, leftover unclaimed epochs can block **withdraw**. This page is that gap: list what is still claimable, claim it, then undelegate / withdraw on that same position.

## How lookup works

Paste (or connect-to-fill) the **delegator / withdrawal-authority** address and Lookup.

Positions are discovered **on-chain** (one delegated stake account per card — two stakes to the same operator stay two cards). Cards paint first. Epoch rows fill as indexer **Merkle openings** and `stakeOffset` arrive in parallel. Proofs cache in the browser; force refresh clears that and re-reads chain `claimedRewardsEpoch`.

Rewards indexer calls go through this origin (`/api/stake-indexing`) with Arcium’s site Origin/Referer. Hitting the indexer from a random origin 403s. Operator names come from a proxied copy of the staking site, not a hardcoded pair of validators.

## How a claim works

Each leftover epoch is one `claim_delegated_stake_rewards` instruction. The program checks an epoch-specific Merkle proof. Those openings are large, so a Solana transaction (~1232 bytes) usually holds **one** claim ix.

**Claim all** on a card is that position only. The toolbar walks **one position after another** (card order) and stops if a batch stops. You still typically get **one wallet approval** (`signAll`) for the remaining txs of that stretch; this page then **sends and confirms one tx at a time** in epoch order. It does not dump every signed tx into the mempool at once (that races the same PDA and surfaces `rewardsAlreadyClaimed` / `rewardsNotClaimed`). If an instruction **fails on-chain**, remaining signed txs are not sent. If a send dies because the blockhash expired, only the **unsent** remainder is rebuilt. Confirm is by **signature**; an expired block height can still land — statuses are checked again before calling a tx dropped.

SOL in the wallet “balance change” line is **net**: leftover reward minus the **Solana** fee (base signature + a small priority fee on the tx so it lands). This site takes none of that SOL. Dust epochs can look red and still have to be claimed **in order** so you can exit.

## How exit works

**Undelegate** starts cooldown. ARX stays in the stake account. **Withdraw** (`closeDelegatedStake`) is offered here only when leftover claimable epochs are gone and unbonding has finished (current epoch past deactivation). That cooldown is typically a couple of Arcium epochs, not a promise.

## What this is not

Not the official staking portal. Not a mixer of two positions into one global claim. Not a hosted key. RPC stays on the server (`/rpc`); the page never needs an API key in `VITE_*`.
