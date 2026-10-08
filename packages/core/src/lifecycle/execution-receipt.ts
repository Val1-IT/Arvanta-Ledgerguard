import type { VerificationResult } from '../types';
import { DEFAULT_ADAPTER_CAPABILITIES, type AdapterCapabilities } from '../ports/system-of-record';
import type { StaleReservationClassification } from './classify-stale-reservation';
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
  recovered: boolean;
  recoveryClassification: StaleReservationClassification | null;
  occurredAt: string;
}

export function adapterCapabilitiesOrDefault(
  capabilities: AdapterCapabilities | undefined
): Pick<ExecutionReceiptAdapter, 'nativeTransactions' | 'idempotencyInNativeTransaction'> {
  return {
    nativeTransactions: capabilities?.nativeTransactions ?? DEFAULT_ADAPTER_CAPABILITIES.nativeTransactions,
    idempotencyInNativeTransaction:
      capabilities?.idempotencyInNativeTransaction ?? DEFAULT_ADAPTER_CAPABILITIES.idempotencyInNativeTransaction
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
  recovered?: boolean;
  recoveryClassification?: StaleReservationClassification | null;
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
    recovered: input.recovered ?? false,
    recoveryClassification: input.recoveryClassification ?? null,
    occurredAt: input.occurredAt
  };
}
