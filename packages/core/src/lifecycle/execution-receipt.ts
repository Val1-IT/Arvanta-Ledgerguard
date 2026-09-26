import type { VerificationResult } from '../types';
import type { AdapterCapabilities } from '../ports/system-of-record';
import type { ExecutionStatusName } from './execution-status';

export const EXECUTION_RECEIPT_SCHEMA_VERSION = '0.2' as const;

export interface ExecutionReceiptAdapter {
  systemId: string;
  systemType: string;
  nativeTransactions: boolean;
  idempotencyInNativeTransaction: boolean;
}

export interface ExecutionReceipt {
  schemaVersion: typeof EXECUTION_RECEIPT_SCHEMA_VERSION;
  executionId: string;
  planId: string;
  planVersion: number;
  idempotencyKey: string;
  status: ExecutionStatusName;
  sourceStateFingerprint: string;
  adapter: ExecutionReceiptAdapter;
  verificationOverallStatus: VerificationResult['overallStatus'] | null;
  committed: boolean;
  occurredAt: string;
}

export function adapterCapabilitiesOrDefault(
  capabilities: AdapterCapabilities | undefined
): Pick<ExecutionReceiptAdapter, 'nativeTransactions' | 'idempotencyInNativeTransaction'> {
  return {
    nativeTransactions: capabilities?.nativeTransactions ?? false,
    idempotencyInNativeTransaction: capabilities?.idempotencyInNativeTransaction ?? false
  };
}

export function buildExecutionReceipt(input: {
  executionId: string;
  planId: string;
  planVersion: number;
  idempotencyKey: string;
  status: ExecutionStatusName;
  sourceStateFingerprint: string;
  adapter: ExecutionReceiptAdapter;
  verificationOverallStatus?: VerificationResult['overallStatus'] | null;
  committed: boolean;
  occurredAt: string;
}): ExecutionReceipt {
  return {
    schemaVersion: EXECUTION_RECEIPT_SCHEMA_VERSION,
    executionId: input.executionId,
    planId: input.planId,
    planVersion: input.planVersion,
    idempotencyKey: input.idempotencyKey,
    status: input.status,
    sourceStateFingerprint: input.sourceStateFingerprint,
    adapter: input.adapter,
    verificationOverallStatus: input.verificationOverallStatus ?? null,
    committed: input.committed,
    occurredAt: input.occurredAt
  };
}
