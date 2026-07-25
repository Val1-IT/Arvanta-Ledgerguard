import { z } from 'zod';

export const OverviewIncidentSummarySchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  title: z.string(),
  overallStatus: z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN']),
  finalState: z.string(),
  primaryExposure: z.string().nullable(),
  currency: z.literal('IDR').nullable(),
  createdAt: z.string(),
  recommendedNextStep: z.string().nullable()
});
export type OverviewIncidentSummary = z.infer<typeof OverviewIncidentSummarySchema>;

export const OverviewViewModelSchema = z.object({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.string(),
  dataHealth: z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL']),
  activeIncidentCount: z.number().int().nonnegative(),
  inventoryValue: z.string(),
  inventoryValueLabel: z.string(),
  grossMarginPercentage: z.string(),
  grossMarginLabel: z.string(),
  datahubStatus: z.enum(['CONNECTED', 'UNAVAILABLE', 'NOT_CONFIGURED']),
  datahubStatusDetail: z.string(),
  lastVerificationStatus: z.enum(['PASS', 'FAIL']),
  lastVerificationAt: z.string(),
  lastVerificationFailingChecks: z.array(z.string()),
  lineageSteps: z.array(z.string()),
  recentIncidents: z.array(OverviewIncidentSummarySchema),
  demoModeEnabled: z.boolean(),
  resetDisabledReason: z.string().nullable(),
  simulateDisabledReason: z.string().nullable(),
  backendAvailable: z.boolean(),
  backendError: z.string().nullable()
});
export type OverviewViewModel = z.infer<typeof OverviewViewModelSchema>;
