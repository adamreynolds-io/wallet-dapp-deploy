# wallet-dapp-deploy

Deploy the [midnight-wallet-dapp](https://github.com/midnight-ntwrk/midnight-wallet-dapp) `token-transfers` contract to the Midnight network.

This is a standalone deploy harness — no browser, no React. Just a vitest suite that builds a wallet, deploys the contract, and calls `mintAndReceive()` as a smoke test.

## Prerequisites

- **Node.js** >= 22
- **Yarn** 1.22+
- **Proof server** running on `localhost:6300` (or set `PROOF_SERVER_URL`)
  ```bash
  docker run -d -p 6300:6300 ghcr.io/midnight-ntwrk/proof-server:8.0.2 midnight-proof-server -v
  ```
- **Funded wallet seed** (64-char hex string) for mainnet deployment

## Quick start

```bash
# Install dependencies
yarn install

# Create .env with your funded wallet seed
echo 'MIDNIGHT_SEED=<your-64-char-hex-seed>' > .env

# Deploy to mainnet
source .env && MIDNIGHT_NETWORK=mainnet MIDNIGHT_SEED="$MIDNIGHT_SEED" yarn test
```

The contract address is printed at the end of the deploy test:

```
============================================================
CONTRACT ADDRESS: c53e8437a633b118ddd3c401119031e866be092a83b6efe402ced9ad581b0c9a
============================================================
```

## Scripts

| Command | Description |
|---------|-------------|
| `yarn test` | Run deploy test (defaults to local) |
| `yarn test:mainnet` | Deploy to mainnet (requires `MIDNIGHT_SEED`) |
| `yarn compile` | Recompile contract from source (requires `compact` CLI) |

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MIDNIGHT_SEED` | Mainnet only | — | Funded wallet seed (64-char hex) |
| `MIDNIGHT_NETWORK` | No | `local` | `local` or `mainnet` |
| `PROOF_SERVER_URL` | No | `http://localhost:6300` | Proof server endpoint |
| `MIDNIGHT_INDEXER` | No | Mainnet default | Indexer GraphQL URL |
| `MIDNIGHT_INDEXER_WS` | No | Mainnet default | Indexer WebSocket URL |
| `MIDNIGHT_RPC_HOST` | No | `td-rpc.mainnet.midnight.network` | Node RPC host |
| `LOG_LEVEL` | No | `info` | Pino log level |

## Contract

The `token-transfers.compact` contract supports:

- `mintAndReceive(amount)` — mint unshielded tokens
- `sendToUser(amount, address)` — send unshielded tokens
- `receiveTokens(amount)` — receive unshielded tokens
- `receiveNightTokens(amount)` — receive NIGHT tokens
- `sendNightTokensToUser(amount, address)` — send NIGHT tokens
- `receiveShieldedTokens(coin)` — receive shielded tokens
- `sendShieldedToUser(input, publicKey, value)` — send shielded tokens
- `mintShieldedToSelf(domainSep, value, nonce)` — mint shielded tokens
- `mintAndSendShielded(domainSep, mintValue, mintNonce, publicKey, sendValue)` — mint and send shielded tokens

Source: [`contract/token-transfers.compact`](contract/token-transfers.compact)

## Project structure

```
wallet-dapp-deploy/
├── contract/
│   ├── token-transfers.compact    # Contract source
│   ├── index.ts                   # Contract wrapper
│   └── managed/token-transfers/   # Compiled artifacts (keys, zkir, JS)
├── src/
│   ├── config.ts                  # Network configuration
│   ├── wallet.ts                  # Wallet provider
│   ├── providers.ts               # Midnight-js provider setup
│   └── test/deploy.test.ts        # Deploy + smoke test
├── compose.yml                    # Local dev stack (Docker)
└── .env.example                   # Environment template
```
