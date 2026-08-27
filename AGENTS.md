## Learned User Preferences

- Paste a Solana address first (read-only), then connect a wallet to claim (connect auto-fills the lookup). Wallet Standard (Phantom / Solflare / Backpack), not Phantom-only.
- Public GitHub for audit (source-available MIT community helper, unofficial — not Arcium; do not copy stake.arcium.com chrome). No extra header nav; disclaimer keeps Official staking portal link. Host on Vercel with serverless proxies until Arcium ships official claim-all. Do not put RPC keys in `VITE_*`.
- Claim is per delegated position (Claim all / Claim next on that card), not a global mix across positions. Do not ship a PRIVATE_KEY/CLI product.
- Merkle claim ixs rarely pack into one Solana tx. One wallet Confirm can `signAll` the remaining set; extra popup only if the blockhash is dying. Send+confirm sequentially (same stake account / epoch order); do not broadcast all signed claims at once.
- After a claim, confirm by signature (expired block height can still land); strip claimed rows on land.
- Keep RPC keys in quoted server-side `RPC_URL` in `.env` (and Vercel project env). Do not use `VITE_RPC_URL` (key would land in the page).
- Paint positions first; stream epoch proofs into each table as they arrive in parallel. Do not wait for a full indexer pass before showing cards.
- Activity strip sits under the toolbar and is expandable (latest as heading; expand for full log).
- Already-undelegated positions: claim leftover rewards then close/withdraw (Undelegate off). Exit is undelegate, then later `closeDelegatedStake`. Leftover/dust epochs must be claimed in order before withdraw.
- Responsive: desktop keeps joined lookup + centered sheet; phone stacks at ≤640px. Do not ship a mobile-only squeezed card or a desktop-only layout.
- Official Arcium logomark on both sides of the title; title case `Arcium Batch Claim`.
- FAQ for average users: wallet negative SOL on a claim is reward minus fee; leftover epochs must be claimed before withdraw after undelegate; dust claims still go in epoch order.

## Learned Workspace Facts

- Product is the Vite app. Dev: `npm run dev` (5173, Vite proxies). Public: Vercel (`dist` + `/api` functions). `npm start` is local preview on 4173 with the same Vite proxies. `arcium_batch_claim.ts` is a deprecated Node stub.
- Each `claim_delegated_stake_rewards` ix needs an epoch-specific Merkle opening and `stakeOffset` from Arcium’s rewards indexer; packing ixs from IDL alone is not enough.
- Vite (dev) and Vercel functions proxy `/api/stake-indexing` to `https://stake.arcium.com` with that origin/referer; unproxied indexer calls return 403 forbidden origin.
- Browser RPC must be an absolute `http(s):` URL to `/rpc` (web3.js rejects `/rpc`). Vercel rewrites `/rpc` → `/api/rpc` using `RPC_URL`. Public `api.mainnet-beta.solana.com` often 403s `getAccountInfo`.
- Quote Helius `RPC_URL` so the `?api-key=` is not stripped. Restart after `.env` changes; if 5173 is already in use, Vite may silently bind 5174.
- Discover delegated positions on-chain (one per validator); do not hardcode a single position.
- Proofs cache in localStorage. Force refresh clears that cache and re-fetches chain `claimedRewardsEpoch` plus indexer proofs with skipCache (stale pending rows after claiming one epoch).
- Browser `Buffer` must be polyfilled before `@solana/spl-token` or the page is blank.
- App ships `/favicon.svg`; a cached localhost favicon from a prior origin is unrelated.
- `/stake-site` is proxied to `https://stake.arcium.com` (strip prefix) for operator names.
