import { z } from 'zod';
import * as V from './views.js';

export * from './envelope.js';
export * from './views.js';

export type WorkItemView = z.infer<typeof V.WorkItemViewSchema>;
export type RunView = z.infer<typeof V.RunViewSchema>;
export type StepRunView = z.infer<typeof V.StepRunViewSchema>;
export type ArtifactView = z.infer<typeof V.ArtifactViewSchema>;
export type DecisionView = z.infer<typeof V.DecisionViewSchema>;
export type BlockerView = z.infer<typeof V.BlockerViewSchema>;
export type EnrichedBlockerView = z.infer<typeof V.EnrichedBlockerViewSchema>;
export type WorkBlockers = z.infer<typeof V.WorkBlockersSchema>;
export type LeaseView = z.infer<typeof V.LeaseViewSchema>;
export type WorkflowDefSummary = z.infer<typeof V.WorkflowDefSummarySchema>;
export type WorkflowDefView = z.infer<typeof V.WorkflowDefViewSchema>;
