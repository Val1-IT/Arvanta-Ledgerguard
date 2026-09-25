import {
  DataHubBridgeError,
  EMPTY_CATALOG_CONTEXT,
  isDataHubConfigured,
  readDataHubContext,
  resolveDataHubIncident,
  writeInvestigationSummary,
  type CatalogActivityEntry,
  type CatalogContext
} from '@ledgerguard/datahub';
import type { ActivityLogEntry, DataHubContext, DataHubSource } from './types';

export interface CatalogReadResult {
  context: DataHubContext;
  source: DataHubSource;
  activityLog: ActivityLogEntry[];
}

export interface InvestigationContextProvider {
  readContext(triggerAsset: string): Promise<CatalogReadResult>;
}

export interface InvestigationStatusPublisher {
  publishInvestigationNote(
    targetAsset: string,
    summaryText: string
  ): Promise<{ writePath: 'mcp' | 'sdk'; activityLog: ActivityLogEntry[] }>;
  publishResolution(
    targetAsset: string,
    addTrustedTag: boolean,
    summaryText: string
  ): Promise<{
    writePath: 'mcp' | 'sdk';
    atRiskTagRemoved: boolean;
    trustedTagAdded: boolean;
    activityLog: ActivityLogEntry[];
  }>;
}

function toActivityLog(entries: CatalogActivityEntry[]): ActivityLogEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function notConfiguredCatalogRead(): CatalogReadResult {
  return {
    context: EMPTY_CATALOG_CONTEXT,
    source: 'NOT_CONFIGURED',
    activityLog: []
  };
}

export function createDataHubContextProvider(): InvestigationContextProvider {
  return {
    async readContext(triggerAsset: string): Promise<CatalogReadResult> {
      if (!isDataHubConfigured()) {
        return notConfiguredCatalogRead();
      }
      try {
        const read = await readDataHubContext(triggerAsset);
        return {
          context: read.datahubContext,
          source: 'LIVE_MCP',
          activityLog: toActivityLog(read.activityLog)
        };
      } catch (error) {
        if (error instanceof DataHubBridgeError) {
          return {
            context: EMPTY_CATALOG_CONTEXT,
            source: 'UNAVAILABLE',
            activityLog: toActivityLog(error.activityLog)
          };
        }
        return {
          context: EMPTY_CATALOG_CONTEXT,
          source: 'UNAVAILABLE',
          activityLog: []
        };
      }
    }
  };
}

export function createDataHubStatusPublisher(): InvestigationStatusPublisher {
  return {
    async publishInvestigationNote(targetAsset, summaryText) {
      const result = await writeInvestigationSummary(targetAsset, summaryText);
      return { writePath: result.writePath, activityLog: toActivityLog(result.activityLog) };
    },
    async publishResolution(targetAsset, addTrustedTag, summaryText) {
      const result = await resolveDataHubIncident(targetAsset, addTrustedTag, summaryText);
      return {
        writePath: result.writePath,
        atRiskTagRemoved: result.atRiskTagRemoved,
        trustedTagAdded: result.trustedTagAdded,
        activityLog: toActivityLog(result.activityLog)
      };
    }
  };
}

export function emptyCatalogContext(): CatalogContext {
  return { ...EMPTY_CATALOG_CONTEXT };
}
