// Pump.fun Replay Sprint: Paper Bot — confirmed-flow scalper.
//
// Idea (from the protocol + fee math, nothing else): most pump.fun coins die
// fast, a few run hard. So buy SMALL (0.05 SOL) and ONLY after real buy flow
// confirms (several distinct buyers, buys dominating sells, price already up
// a little from creation), then exit fast: +35% take-profit, -12% stop,
// trailing exit once +20%, or a trade-count time stop. One entry per mint,
// at most 5 open positions, never more than 0.8% of a curve's real SOL
// reserve in one buy (the cap is 1%). Fully deterministic: no clock, no
// randomness, no environment reads — the two grading runs must agree.
//
// Fee reality: ~1.25% curve fees each way + 105,000 lamports tx fee per
// order. On a 0.05 SOL buy the round trip costs ~3% of the stake, so the
// exits above are set well clear of that. The guardrail needs >= 20 coins
// with round trips of >= 0.01 SOL; 0.05 SOL buys clear it with margin.

import { runBot } from "./vendor/makefun-bot.ts";
import type { Batch, BotState } from "./vendor/makefun-bot.ts";

// ---------------------------------------------------------------- tuning
const BUY_LAMPORTS = 50_000_000n; // 0.05 SOL per entry
const MIN_BUY_LAMPORTS = 20_000_000n; // never below this (guardrail is 0.01 SOL)
const BUY_CAP_BPS = 800n; // of the curve's real SOL reserve (cap is 1000)
const BUY_SLIPPAGE_BPS = 700;
const SELL_SLIPPAGE_BPS = 1000;

const ENTRY_MAX_TRADES = 30; // only coins this young: catch the move earlier
const WINDOW_TRADES = 10; // recent-flow window
const WINDOW_MIN_TRADES = 6;
const WINDOW_MIN_BUYS = 5;
const WINDOW_MIN_BUY_SOL = 1_200_000_000n; // 1.2 SOL of buys in the window
const WINDOW_MIN_BUYERS = 6; // distinct buyers in the window
const WINDOW_MIN_RISE_BPS = 1200; // +12% inside the window
const CREATE_MIN_RISE_BPS = 800; // +8% from creation price
const CREATE_MAX_RISE_BPS = 4000; // never chase more than +40% from creation
const MIN_REAL_SOL = 2_500_000_000n; // 2.5 SOL real reserve before entry

const TAKE_PROFIT_BPS = 1200; // +12%: bank the herd continuation fast
const STOP_LOSS_BPS = -600; // -6%
const TRAIL_ARM_BPS = 800; // start trailing once +8%
const TRAIL_DROP_BPS = 400n; // sell 4% below the peak
const MAX_HOLD_TRADES = 40; // time stop, in trades on that mint

const PRICE_SCALE = 1_000_000_000n;

// ---------------------------------------------------------------- per-mint track
interface RecentTrade {
  buy: boolean;
  sol: bigint;
  user: string;
  price: bigint;
}

interface MintTrack {
  createdSlot: number;
  createPrice: bigint;
  trades: number;
  recent: RecentTrade[];
  lastPrice: bigint;
  entered: boolean;
  entryPrice: bigint;
  peakPrice: bigint;
  entryTrades: number;
}

const tracks = new Map<string, MintTrack>();

function priceOf(vSol: bigint, vTok: bigint): bigint {
  if (vTok <= 0n) return 0n;
  return (vSol * PRICE_SCALE) / vTok;
}

function bpsChange(from: bigint, to: bigint): bigint {
  if (from <= 0n) return 0n;
  return ((to - from) * 10_000n) / from;
}

function trackFor(mint: string): MintTrack {
  let t = tracks.get(mint);
  if (t === undefined) {
    t = {
      createdSlot: 0,
      createPrice: 0n,
      trades: 0,
      recent: [],
      lastPrice: 0n,
      entered: false,
      entryPrice: 0n,
      peakPrice: 0n,
      entryTrades: 0,
    };
    tracks.set(mint, t);
  }
  return t;
}

function hasPendingBuy(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.side === "buy" && p.order.mint === mint) return true;
  }
  return false;
}

// ---------------------------------------------------------------- strategy
function entrySignal(state: BotState, mint: string): bigint | null {
  const t = tracks.get(mint);
  if (t === undefined) return null;
  if (t.entered) return null;
  if (t.trades > ENTRY_MAX_TRADES) return null;
  if (t.createPrice <= 0n || t.lastPrice <= 0n) return null;
  const curve = state.curves.get(mint);
  if (curve === undefined || curve.complete) return null;
  if (curve.real_quote_reserves < MIN_REAL_SOL) return null;

  const riseFromCreate = bpsChange(t.createPrice, t.lastPrice);
  if (riseFromCreate < CREATE_MIN_RISE_BPS) return null;
  if (riseFromCreate > CREATE_MAX_RISE_BPS) return null;

  const w = t.recent.slice(-WINDOW_TRADES);
  if (w.length < WINDOW_MIN_TRADES) return null;
  let buys = 0;
  let buySol = 0n;
  let sellSol = 0n;
  const buyers = new Set<string>();
  for (const r of w) {
    if (r.buy) {
      buys += 1;
      buySol += r.sol;
      buyers.add(r.user);
    } else {
      sellSol += r.sol;
    }
  }
  if (buys < WINDOW_MIN_BUYS) return null;
  if (buySol < WINDOW_MIN_BUY_SOL) return null;
  if (buyers.size < WINDOW_MIN_BUYERS) return null;
  if (buySol < sellSol * 2n) return null;
  if (bpsChange(w[0].price, t.lastPrice) < WINDOW_MIN_RISE_BPS) return null;

  // Size: 0.05 SOL, but never over 0.8% of the real reserve (cap is 1%).
  const cap = (curve.real_quote_reserves * BUY_CAP_BPS) / 10_000n;
  const size = BUY_LAMPORTS < cap ? BUY_LAMPORTS : cap;
  if (size < MIN_BUY_LAMPORTS) return null;
  return size;
}

function exitFor(state: BotState, mint: string): boolean {
  const t = tracks.get(mint);
  if (t === undefined || t.entryPrice <= 0n) return false;
  const curve = state.curves.get(mint);
  if (curve !== undefined && curve.complete) return false;
  const price = t.lastPrice;
  if (price <= 0n) return false;
  const pnl = bpsChange(t.entryPrice, price);
  if (pnl >= TAKE_PROFIT_BPS) return true;
  if (pnl <= STOP_LOSS_BPS) return true;
  if (pnl >= TRAIL_ARM_BPS && price > t.peakPrice) t.peakPrice = price;
  if (t.peakPrice > 0n && pnl >= TRAIL_ARM_BPS) {
    if (price <= (t.peakPrice * (10_000n - TRAIL_DROP_BPS)) / 10_000n) return true;
  }
  if (t.trades - t.entryTrades >= MAX_HOLD_TRADES) return true;
  return false;
}

// ---------------------------------------------------------------- bot loop
await runBot({
  onHello(_state) {
    // Nothing to seed: the strategy is deterministic from the event stream.
  },

  onBatch(state: BotState, batch: Batch) {
    // A buy that was rejected or failed frees its mint for a fresh signal.
    for (const f of batch.fills) {
      if (f.side === "buy" && f.status !== "filled") {
        const t = tracks.get(f.mint);
        if (t !== undefined && !state.positions.has(f.mint)) {
          t.entered = false;
          t.entryPrice = 0n;
          t.peakPrice = 0n;
        }
      }
    }

    // Fold this batch's events into the per-mint tracks.
    const touched = new Set<string>();
    for (const e of batch.events) {
      if (e.event === "CreateEvent") {
        const t = trackFor(e.mint);
        t.createdSlot = e.slot;
        t.createPrice = priceOf(BigInt(e.virtual_sol_reserves), BigInt(e.virtual_token_reserves));
        t.lastPrice = t.createPrice;
      } else if (e.event === "TradeEvent") {
        const t = trackFor(e.mint);
        const price = priceOf(BigInt(e.virtual_sol_reserves), BigInt(e.virtual_token_reserves));
        t.trades += 1;
        t.lastPrice = price;
        t.recent.push({
          buy: e.is_buy,
          sol: BigInt(e.sol_amount),
          user: e.user,
          price,
        });
        if (t.recent.length > WINDOW_TRADES) t.recent.shift();
        if (state.positions.has(e.mint) && price > t.peakPrice) t.peakPrice = price;
        touched.add(e.mint);
      }
    }
    // Marks refresh the price of held mints even when they did not trade.
    for (const m of batch.marks) {
      const t = tracks.get(m.mint);
      if (t === undefined) continue;
      const price = priceOf(BigInt(m.virtual_quote_reserves), BigInt(m.virtual_token_reserves));
      if (price > 0n) {
        t.lastPrice = price;
        if (state.positions.has(m.mint) && price > t.peakPrice) t.peakPrice = price;
      }
    }

    const orders: {
      side: "buy" | "sell";
      mint: string;
      quote_lamports?: bigint;
      token_amount?: bigint;
      max_slippage_bps: number;
    }[] = [];

    // Exits first: free a position slot before deciding entries.
    for (const [mint, holding] of state.positions) {
      if (holding.token_amount <= 0n) continue;
      if (exitFor(state, mint)) {
        orders.push({
          side: "sell",
          mint,
          token_amount: holding.token_amount,
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
      }
    }

    // Entries: one per touched mint, while a position slot is free.
    const maxPositions = state.hello.caps.max_open_positions;
    let spentThisBatch = 0n;
    for (const mint of touched) {
      if (orders.length >= state.hello.caps.max_orders_per_batch) break;
      if (state.positions.has(mint)) continue;
      if (hasPendingBuy(state, mint)) continue;
      let open = state.committedPositionCount();
      for (const o of orders) open += o.side === "buy" ? 1 : -1;
      if (open >= maxPositions) break;
      const size = entrySignal(state, mint);
      if (size === null) continue;
      const need = size + state.txFeeLamports();
      if (state.freeCashLamports() - spentThisBatch - need < 0n) continue;
      spentThisBatch += need;
      const t = trackFor(mint);
      t.entered = true;
      t.entryPrice = t.lastPrice;
      t.peakPrice = t.lastPrice;
      t.entryTrades = t.trades;
      orders.push({
        side: "buy",
        mint,
        quote_lamports: size,
        max_slippage_bps: BUY_SLIPPAGE_BPS,
      });
    }

    // The SDK shim types the reply; keep the wire shape exact.
    return orders.map((o) =>
      o.side === "buy"
        ? {
            side: "buy" as const,
            mint: o.mint,
            quote_lamports: o.quote_lamports as bigint,
            max_slippage_bps: o.max_slippage_bps,
          }
        : {
            side: "sell" as const,
            mint: o.mint,
            token_amount: o.token_amount as bigint,
            max_slippage_bps: o.max_slippage_bps,
          },
    );
  },

  onDone(_state) {
    // The harness flattens any open position; nothing to send.
  },
});
