// Frontend view of the shared timeline engine, bound to the current recording's duration.
import { initState as init, replay as rep, type OpRecord } from '../../../shared/timeline'
import { SRC_DUR } from './sample'
export * from '../../../shared/timeline'
export type { Range } from '../../../shared/types'
export const initStateNow = () => init(SRC_DUR)
export const replayNow = (log: OpRecord[], cursor: number) => rep(log, cursor, SRC_DUR)
