# Sigma on one VPS

The shadow run of Sigma runs on one OVH VPS (2 vCore, 4 GB, Ubuntu 26.04, Caddy already
installed) next to the public full node's gRPC at 158.69.54.239:9000. Everything here is
committed; the secrets are not and go into `/etc/sigma` by hand.

| Process | Unit | Listens | Reads |
|---|---|---|---|
| Price service (oracle-v2) | sigma-oracle | 127.0.0.1:8787, published as oracle.haneul.io | exchanges; the signer seed and the relayer key |
| Indexer | sigma-indexer | metrics 9184 | the full node, Postgres `perp_indexer` |
| API | sigma-api | 127.0.0.1:3002, published as api.sigma.haneul.io | Postgres, `/etc/sigma/perp.mainnet.json` |
| Liquidator | sigma-liquidator | 127.0.0.1:9188 (health) | Postgres, the price service, its key and account |
| Cranker | sigma-cranker | 127.0.0.1:9189 (health) | the price service, its key |
| Site | Caddy | sigma.haneul.io | `/var/www/sigma` (the production build) |
| gRPC proxy | Caddy | rpc.haneul.io | 158.69.54.239:9000 over h2c |

## Once

```sh
scp -r deploy/vps ubuntu@149.56.47.78:/tmp/
ssh ubuntu@149.56.47.78 'sudo SIGMA_DB_PASSWORD=<password> bash /tmp/vps/bootstrap.sh'
```

Then the secrets, all root-owned and mode 600 under `/etc/sigma`:

- `perp.mainnet.json`: `public/configs/haneul/perp.mainnet.json` with `updatesUrl` left as is (the
  bots are given the local service's address on their command lines).
- `oracle.env`: `ORACLE_CONFIG=/etc/sigma/oracle-v2.json`, `ORACLE_SIGNER_SEED=<64 hex>`,
  `RELAYER_KEY=haneulprivkey1…` of the relayer wallet. `oracle-v2.json` is
  `.deploy/oracle-v2.mainnet.json` with `httpHost` 127.0.0.1.
- `indexer.env`: `DATABASE_URL=postgres://sigma:<password>@127.0.0.1:5432/perp_indexer` and
  `PERP_PACKAGES=perpetuals=0x…,perpetuals_orders=0x…,oracle_aggregator=0x…,market_making_vault=0x…,perpetuals_fees=0x…,oracle_haneul=0x…`
  from the deployment file.
- `api.env`: the same `DATABASE_URL` with `?application_name=perp-api`.
- `liquidator.env`: `DATABASE_URL`, `ACCOUNT=<Account object>`, `ACCOUNT_CAP=<assistant cap>`;
  `liquidator.key` and `cranker.key`: the wallets' `haneulprivkey1…` strings, one per file.

The liquidator's account and assistant cap are created with its own key from the admin
machine (`perp-liquidator` README) before the unit starts; `--check-only` on the server
verifies everything before the first round.

## Binaries

The Rust binaries are built by GitHub Actions (x86_64, glibc 2.39) on every push to main of
`perp-indexer` and `perp-liquidator` and kept as artifacts. On the server:

```sh
gh run download <run id> -R GeunhwaJeong/perp-indexer -n perp-indexer-linux-x86_64 -D /tmp/bin
gh run download <run id> -R GeunhwaJeong/perp-liquidator -n perp-bots-linux-x86_64 -D /tmp/bin
(cd /tmp/bin && sha256sum -c SHA256SUMS)
sudo install -o sigma -g sigma -m 755 /tmp/bin/perp-* /opt/sigma/bin/
```

oracle-v2 is a checkout of its repository at `/opt/sigma/oracle-v2` with `npm ci --omit=dev`
(node 22 is on the box); the site is `pnpm build` of this repository copied to `/var/www/sigma`.

## Start order

```sh
sudo systemctl enable --now sigma-oracle      # feeds fresh within a few rounds
sudo systemctl enable --now sigma-indexer sigma-api
sudo systemctl enable --now sigma-cranker sigma-liquidator
```

Health: `curl -s localhost:8787/healthz`, `localhost:3002/health`, `localhost:9188/health`,
`localhost:9189/health`. Logs: `journalctl -u sigma-<name> -f`.
