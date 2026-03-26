import { CompiledContract } from '@midnight-ntwrk/compact-js';
import path from 'node:path';

export {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type Witnesses,
  type ImpureCircuits,
  type PureCircuits,
} from './managed/token-transfers/contract/index.js';

import { Contract } from './managed/token-transfers/contract/index.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export const zkConfigPath = path.resolve(
  currentDir,
  'managed',
  'token-transfers',
);

export const CompiledTokenTransfersContract = CompiledContract.make(
  'TokenTransfersContract',
  Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
