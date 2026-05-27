export * from './types/index.js';
export { CodememoryServer } from './mcp/server.js';
export { RuntimeObserver } from './engines/runtime/observer.js';
export { InstrumentationHook } from './engines/runtime/hook.js';

export { RepairAssembler } from './engines/repair/assembler.js';
export { RepairProvenance } from './engines/repair/provenance.js';
export { IntentExtractor } from './engines/intent/extractor.js';
export { IntentBinder } from './engines/intent/binder.js';
export { IntentSearchEngine } from './engines/intent/search.js';
export { LineageEngine } from './engines/intent/lineage.js';

// v0.3.0 exports
export { AutoHealEngine } from './engines/heal/auto-heal.js';
export { PredictiveGuard } from './engines/guard/predictive-guard.js';
export { CrossProjectGraph } from './engines/knowledge/cross-project.js';
export { BehaviorTimelineAggregator } from './engines/timeline/aggregator.js';
export { DashboardServer } from './web/server.js';

// v0.3.5 exports
export { RelayEngine } from './engines/relay/engine.js';
export { encrypt, decrypt, generatePairingKey, getPairingFingerprint } from './engines/relay/encryption.js';
export { RelayDiscovery } from './engines/relay/discovery.js';
export { RelayServer } from './engines/relay/relay.js';

export { DatabaseManager } from './store/database.js';
export { logger } from './utils/logger.js';
export { sanitizer } from './utils/sanitizer.js';
export { hash } from './utils/hash.js';
export { CodememoryError, CODEMEMORY_ERROR_CODES, formatToolError } from './utils/errors.js';
export type { RuntimeRecordResult } from './engines/runtime/observer.js';
