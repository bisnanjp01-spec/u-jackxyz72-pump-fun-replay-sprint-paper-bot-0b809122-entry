# u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/bisnanjp01-spec/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/bisnanjp01-spec/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Pump.fun Replay Sprint: Paper Bot — a confirmed-flow scalper that trades 10 SOL of paper money on a replay of pump.fun bonding-curve activity. It buys small (0.05 SOL) only after strong buy flow confirms on a young coin — at most 30 trades old, at least 6 distinct buyers and 1.2 SOL of buys in its last 10 trades, price up at least 12% inside that window and 8–40% from creation, with at least 2.5 SOL of real reserve — then exits fast: +12% take-profit, −6% stop, a trailing exit once +8% (4% below the peak), or a 40-trade time stop. One entry per mint, at most 5 open positions, never more than 0.8% of a curve's real SOL reserve in one buy. Fully deterministic: no clock, no randomness, no network — the two grading runs must agree.

Local dev grade on the kit's dev window (process driver, unofficial): +0.024 SOL net PnL over 44 coins, 45% win rate, 0.4% max drawdown, guardrails met.

## Run it

```sh
node main.ts
```

Node 22.18+ runs the TypeScript directly (the grader runs `node /bot/main.ts`); nothing to install. The bot speaks `agent-fun/replay/v2` on stdin/stdout: the harness sends `hello`, then one `batch` per slot and a final `done`; the bot answers each `batch` with exactly one `reply` carrying its `orders`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
