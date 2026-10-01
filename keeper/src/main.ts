import { startApi } from './api';
import { startBots } from './bots';
import { startIndexer } from './indexer';
import { startKeeper } from './keeper';
import { startPrices } from './prices';
import { startGasStation } from './gas';
import { startLobbyGuard } from './lobby';
import { startRelay } from './relay';
import { preflight } from './preflight';

await preflight();
await startPrices();
await startIndexer();
startApi();
startKeeper();
startGasStation();
startRelay();
startLobbyGuard();
await startBots();
