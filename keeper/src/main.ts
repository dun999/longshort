import { startApi } from './api';
import { startBots } from './bots';
import { startIndexer } from './indexer';
import { startKeeper } from './keeper';
import { startPrices } from './prices';
import { startGasStation } from './gas';
import { startLobbyGuard } from './lobby';

await startPrices();
await startIndexer();
startApi();
startKeeper();
startGasStation();
startLobbyGuard();
await startBots();
