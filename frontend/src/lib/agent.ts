import { buildPlan as build, intentIsEmpty, parseIntent, parseTasks, RULES_HELP, SUGGESTIONS, type Intent, type Plan, type PlanItem, type PlanGroup, type Prefs, type Task } from '../../../shared/planner'
import type { TimelineState } from '../../../shared/timeline'
import { INDEX } from './sample'
export { intentIsEmpty, parseIntent, parseTasks, RULES_HELP, SUGGESTIONS }
export type { Intent, Plan, PlanItem, PlanGroup, Prefs, Task }
export const buildPlan = (st: TimelineState, what: Set<Task> | Intent, prefs?: Prefs) => build(INDEX, st, what, prefs)
