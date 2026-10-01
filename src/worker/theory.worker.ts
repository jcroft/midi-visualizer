// CONTRACT (owned by the theory worker). Receives PianoSnapshots, posts Analysis.
/// <reference lib="webworker" />
import type { ToWorker } from '@shared/analysis';
self.onmessage = (_e: MessageEvent<ToWorker>) => {};
