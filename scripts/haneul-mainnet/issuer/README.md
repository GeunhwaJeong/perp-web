# Deploying the name issuer

The issuer is one Node process. It is bundled into a single file so the VPS holds no
checkout and no node_modules.

```sh
# 1. Bundle (from the repository root).
node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild \
  scripts/haneul-mainnet/name-issuer.ts --bundle --platform=node --format=esm \
  --target=node22 --outfile=.deploy/issuer/name-issuer.mjs \
  --banner:js='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'

# 2. Install on the VPS (149.56.47.78).
scp .deploy/issuer/name-issuer.mjs ubuntu@149.56.47.78:/tmp/name-issuer.mjs
ssh ubuntu@149.56.47.78 'sudo install -o sigma -g sigma -m 755 /tmp/name-issuer.mjs /opt/sigma/bin/name-issuer.mjs \
  && sudo install -d -o sigma -g sigma -m 750 /var/lib/sigma/name-issuer \
  && sudo systemctl restart sigma-names && sleep 2 && curl -s http://127.0.0.1:8790/health'
```

`/etc/sigma/name-issuer.env` (root:sigma, 640) holds `NAME_ISSUER_KEY`, `PORT=8790`
(8787 is the oracle's), `ALLOWED_ORIGIN=https://sigma.haneul.io`,
`LEDGER_PATH=/var/lib/sigma/name-issuer/issued.json`, `NAME_YEARS=20`, `GAS_GRANT_HANEUL=1`.
The unit is `sigma-names.service` next to this file. Caddy proxies
`sigma.haneul.io/issuer/*` to the port (`handle_path` strips the prefix), and the web build
is given `VITE_NAME_ISSUER_URL=https://sigma.haneul.io/issuer`.

Before the first issue on a fresh HaneulNS deployment, authorize the controller app once:
`name-issuer.ts authorize --execute` (done on mainnet 2026-10-14, digest
DS25HANgbLgGBde1vxfeumxsvPDh3yy3MW9aTntLWq5r).
