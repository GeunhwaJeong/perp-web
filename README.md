<p align="center"><img src="public/favicon.svg" width="128" alt="Sigma" /></p>

<h1 align="center">Sigma</h1>

<p align="center">Perpetual futures exchange on the Haneul blockchain.</p>

<div align="center">
  <a href="https://sigma.haneul.io"><img src="https://img.shields.io/badge/live-sigma.haneul.io-6966FF" alt="Live" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License" /></a>
</div>

## What this is

Sigma is a decentralised perpetual futures exchange. Markets, order books, positions and
funding live in Move packages on [Haneul](https://github.com/GeunhwaJeong/haneul), an
independent L1. This repository is the trading interface: a React single page app that reads
market data from Sigma's own indexer and signs transactions with a Haneul wallet.

The interface started as a fork of [dYdX v4-web](https://github.com/dydxprotocol/v4-web)
(AGPL-3.0). The dYdX chain client, Cosmos wallets and bridges are being replaced by their Haneul
equivalents; the trading screens, order forms and data layer are kept.

## The stack

| Piece | Repository | What it does |
|---|---|---|
| Engine | [perp-dex](https://github.com/GeunhwaJeong/perp-dex) | Move packages: clearing houses, order book, positions, funding, fees, vault |
| Oracle | [oracle-v2](https://github.com/GeunhwaJeong/oracle-v2) | Forms prices from exchange order books, signs and relays them on chain |
| Indexer and API | [perp-indexer](https://github.com/GeunhwaJeong/perp-indexer) | Follows checkpoints, builds the ledger, serves the REST and WebSocket API this app reads |
| Bots | [perp-liquidator](https://github.com/GeunhwaJeong/perp-liquidator) | Liquidator, funding cranker, market maker |
| Interface | this repository | The web app at [sigma.haneul.io](https://sigma.haneul.io) |

The API follows the dYdX indexer contract (`/v4/*` REST, five WebSocket channels), which is why
the data layer of the interface carries over unchanged.

## Running it

Node 22 and pnpm are required (`engines` is strict).

```sh
pnpm i
pnpm dev
```

The dev server runs at `http://localhost:5173`. In development mode the app points at the
`haneul-localnet` environment and offers a built in dev wallet, so no browser extension is needed.
Environments, endpoints and links live in `public/configs/v1/env.json`; the Move package
addresses the app talks to are in `public/configs/haneul/perp.<network>.json`.

A full local stack (localnet node, engine packages, price pusher, indexer, API) is scripted under
`scripts/haneul-localnet/`. `fixture.mjs` publishes the packages and seeds a market,
`smoke.ts` exercises the transaction builders against the node, and the Playwright scripts
(`browser.mjs`, `read-path.mjs`, `funds.mjs`, `liquidation-price.mjs`, `chart.mjs`) drive the
interface end to end.

Checks:

```sh
pnpm tsc
pnpm lint
pnpm test
pnpm build
```

## Where things are

- `src/haneul/`: the Haneul side. dapp-kit wiring, gRPC client, the transaction builders
  (sessions, orders, collateral, leverage, tickets) and the signed price updates every order
  carries.
- `src/bonsai/`: the data layer. Indexer REST and WebSocket clients, calculators, the order form
  as pure functions, and `AccountTransactionSupervisor`, which turns form payloads into Haneul
  transactions.
- `src/views/`, `src/pages/`, `src/components/`: the screens.
- `deploy/vps/`: Caddy and systemd units for the single server deployment, and the bootstrap
  script.

## Deploying

The site is a static build. `pnpm build` writes `dist/`; the entry page is
`dist/entry-points/index.html`, and the host serves it as the fallback for every path. The
production deployment copies `dist/` to `/var/www/sigma` behind Caddy; see `deploy/vps/README.md`.

## License

AGPL-3.0, see [LICENSE](LICENSE). This repository contains software open sourced by dYdX Trading
Inc. and modifications by Geunhwa Jeong.
