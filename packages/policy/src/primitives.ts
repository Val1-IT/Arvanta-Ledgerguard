import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const Capability = {
  investigationRead: 'investigation.read',
  remediationPropose: 'remediation.propose',
  remediationApprove: 'remediation.approve',
  remediationExecute: 'remediation.execute'
} as const;

export const CapabilitySchema = z.enum([
  Capability.investigationRead,
  Capability.remediationPropose,
  Capability.remediationApprove,
  Capability.remediationExecute
]);

export type CapabilityName = z.infer<typeof CapabilitySchema>;

export const ActorTypeSchema = z.enum(['human', 'system', 'agent']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const AuthorityContextSchema = z.object({
  actorId: z.string().min(1),
  actorType: ActorTypeSchema,
  capabilities: z.array(CapabilitySchema),
  source: z.literal('trusted_runtime'),
  issuedAt: z.string().datetime()
});

export type AuthorityContext = z.infer<typeof AuthorityContextSchema>;

export const PolicyOutcomeSchema = z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']);
export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;

export const PolicyReasonCodeSchema = z.enum([
  'POLICY_PASSED',
  'MISSING_EVIDENCE',
  'MISSING_VERIFICATION',
  'INSUFFICIENT_CAPABILITY',
  'APPROVAL_REQUIRED',
  'APPROVAL_GRANTED',
  'STALE_PLAN_VERSION',
  'AGENT_CANNOT_APPROVE',
  'IMPACT_THRESHOLD_EXCEEDED',
  'DUPLICATE_EXECUTION'
]);

export type PolicyReasonCode = z.infer<typeof PolicyReasonCodeSchema>;

export const PolicyReasonSchema = z.object({
  policyId: z.string().min(1),
  code: PolicyReasonCodeSchema,
  message: z.string().min(1),
  data: z.record(z.unknown()).optional()
});

export type PolicyReason = z.infer<typeof PolicyReasonSchema>;

export const ApprovalRequirementSchema = z.object({
  required: z.boolean(),
  requiredCapability: z.literal(Capability.remediationApprove),
  reasons: z.array(z.string())
});

export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const PolicyDecisionSchema = z.object({
  id: z.string().min(1),
  decidedAt: z.string().datetime(),
  outcome: PolicyOutcomeSchema,
  reasons: z.array(PolicyReasonSchema).min(1),
  policyIds: z.array(z.string()).min(1),
  approval: ApprovalRequirementSchema
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyConfigSchema = z.object({
  financialApprovalThreshold: z.number().nonnegative().nullable(),
  currency: z.string().min(1)
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  financialApprovalThreshold: null,
  currency: 'IDR'
};

export interface PlanApprovalSnapshot {
  state: string;
  version: number;
  approvalAction: string | null;
  approvedBy: string | null;
}

export interface PolicyEvaluationContext {
  evidenceCount: number;
  verificationExpectationCount: number;
  impactAmount: number;
  authority: AuthorityContext;
  requiredCapability: CapabilityName;
  plan: PlanApprovalSnapshot;
  expectedVersion: number;
  config: PolicyConfig;
  idempotencyCompleted: boolean;
}

export function createPolicyId(): string {
  return `pol_${randomUUID().replaceAll('-', '')}`;
}

export function parseAuthorityContext(value: unknown): AuthorityContext {
  return AuthorityContextSchema.parse(value);
}
