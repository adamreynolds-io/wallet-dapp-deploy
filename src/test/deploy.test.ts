/**
 * Deploy the token-transfers contract from midnight-wallet-dapp to Midnight.
 *
 * Uses the same deploy-prove-balance-submit pipeline as pm-22376-validation,
 * adapted for the token-transfers contract (no witnesses, no ledger state).
 *
 * Run against local:   yarn test
 * Run against mainnet: MIDNIGHT_NETWORK=mainnet MIDNIGHT_SEED=<seed> yarn test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createUnprovenDeployTx,
  submitCallTx,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import {
  buildProviders,
  type TokenTransfersProviders,
} from '../providers.js';
import {
  CompiledTokenTransfersContract,
  zkConfigPath,
} from '../../contract/index.js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const LOCAL_DEV_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

const PRIVATE_STATE_ID = 'tokenTransfersPrivateState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  heartbeatMs = 10_000,
): Promise<T> {
  const start = Date.now();
  logger.info(`[${label}] starting...`);
  const heartbeat = setInterval(() => {
    logger.info(`[${label}] still running... ${elapsed(start)} elapsed`);
  }, heartbeatMs);
  try {
    const result = await fn();
    logger.info(`[${label}] completed in ${elapsed(start)}`);
    return result;
  } catch (err) {
    logger.error(`[${label}] FAILED after ${elapsed(start)}: ${err}`);
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

async function checkHealth(config: {
  proofServer: string;
  indexer: string;
}): Promise<void> {
  const checks = [
    {
      name: 'proof-server',
      url: `${config.proofServer}/version`,
    },
    {
      name: 'indexer',
      url: config.indexer,
      body: JSON.stringify({ query: '{ __typename }' }),
    },
  ];

  for (const check of checks) {
    const start = Date.now();
    try {
      const opts: RequestInit = {
        method: check.body ? 'POST' : 'GET',
        headers: check.body
          ? { 'Content-Type': 'application/json' }
          : undefined,
        body: check.body,
        signal: AbortSignal.timeout(10_000),
      };
      const res = await fetch(check.url, opts);
      const text = await res.text();
      const ok = res.status >= 200 && res.status < 400;
      if (ok) {
        logger.info(
          `[health] ${check.name}: OK (${res.status}) in ${elapsed(start)} — ${text.slice(0, 100)}`,
        );
      } else {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      logger.error(
        `[health] ${check.name}: FAILED after ${elapsed(start)} — ${err}`,
      );
      throw new Error(
        `${check.name} health check failed at ${check.url}: ${err}`,
      );
    }
  }
  logger.info('[health] All services healthy');
}

describe('Deploy token-transfers contract', () => {
  let wallet: MidnightWalletProvider;
  let providers: TokenTransfersProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isMainnet = config.networkId === 'mainnet';
  const seed = isMainnet
    ? process.env['MIDNIGHT_SEED']
    : (process.env['MIDNIGHT_SEED'] ?? LOCAL_DEV_SEED);

  beforeAll(async () => {
    if (isMainnet && !process.env['MIDNIGHT_SEED']) {
      logger.warn('MIDNIGHT_SEED not set — skipping mainnet tests');
      return;
    }

    logger.info(`Network: ${config.networkId}`);
    logger.info(`Indexer: ${config.indexer}`);
    logger.info(`Node: ${config.node}`);
    logger.info(`Proof server: ${config.proofServer}`);
    setNetworkId(config.networkId);

    await timed('health-check', () => checkHealth(config));

    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    wallet = await timed('wallet-build', () =>
      MidnightWalletProvider.build(logger, envConfig, seed!),
    );
    await timed('wallet-start', () => wallet.start());
    await timed('wallet-sync', () =>
      syncWallet(logger, wallet.wallet, 600_000),
    );

    providers = buildProviders(wallet, zkConfigPath, config);
    logger.info('Providers initialized. Ready to deploy.');
  }, 15 * 60_000);

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  it.skipIf(isMainnet && !process.env['MIDNIGHT_SEED'])(
    'deploy token-transfers contract',
    async () => {
      // Witnesses are empty, but submitCallTx still requires stored private state
      const initialPrivateState = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unprovenData: any = await timed(
        'deploy:1-create-unproven',
        () =>
          (createUnprovenDeployTx as any)(providers, {
            compiledContract: CompiledTokenTransfersContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState,
            args: [],
          }),
      );
      const pendingAddress = unprovenData.public?.contractAddress;
      logger.info(`Pending contract address: ${pendingAddress}`);

      const provenTx = await timed('deploy:2-prove', () =>
        providers.proofProvider.proveTx(unprovenData.private.unprovenTx),
      );

      const balancedTx = await timed('deploy:3-balance', () =>
        providers.walletProvider.balanceTx(provenTx),
      );

      const txId = await timed('deploy:4-submit', () =>
        providers.midnightProvider.submitTx(balancedTx),
      );
      logger.info(`Submitted deploy tx: ${txId}`);

      const finalizedTxData = await timed(
        'deploy:5-wait-confirmation',
        () => providers.publicDataProvider.watchForTxData(txId),
      );
      logger.info(
        `Deploy finalized! Status: ${finalizedTxData.status}, block: ${finalizedTxData.blockHeight}`,
      );

      providers.privateStateProvider.setContractAddress(pendingAddress);
      await providers.privateStateProvider.set(
        PRIVATE_STATE_ID,
        initialPrivateState,
      );

      contractAddress = pendingAddress;
      logger.info('');
      logger.info('='.repeat(60));
      logger.info(`CONTRACT ADDRESS: ${contractAddress}`);
      logger.info('='.repeat(60));
      logger.info('');

      expect(contractAddress).toBeDefined();
      expect(contractAddress.length).toBeGreaterThan(0);
    },
    10 * 60_000,
  );

  it.skipIf(isMainnet && !process.env['MIDNIGHT_SEED'])(
    'call mintAndReceive() as smoke test',
    async () => {
      expect(contractAddress).toBeDefined();

      const mintAmount = 1n;
      logger.info(`Minting ${mintAmount} token(s)...`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txData: any = await timed('mintAndReceive', () =>
        (submitCallTx as any)(providers, {
          compiledContract: CompiledTokenTransfersContract,
          contractAddress,
          privateStateId: PRIVATE_STATE_ID,
          circuitId: 'mintAndReceive',
          args: [mintAmount],
        }),
      );

      logger.info(`mintAndReceive() tx hash: ${txData.public.txHash}`);
      logger.info(
        `mintAndReceive() block height: ${txData.public.blockHeight}`,
      );
      logger.info(`mintAndReceive() status: ${txData.public.status}`);

      expect(txData.public.status).toBeDefined();
    },
    10 * 60_000,
  );
});
