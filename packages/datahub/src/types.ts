import { z } from 'zod';

export const CatalogContextSchema = z.object({
  assetsRead: z.array(z.string()),
  owners: z.array(z.string()),
  glossaryTerms: z.array(z.string()),
  tags: z.array(z.string()),
  lineagePath: z.array(z.string())
});

export type CatalogContext = z.infer<typeof CatalogContextSchema>;

export const EMPTY_CATALOG_CONTEXT: CatalogContext = {
  assetsRead: [],
  owners: [],
  glossaryTerms: [],
  tags: [],
  lineagePath: []
};

export const DataHubContextSchema = CatalogContextSchema;
export type DataHubContext = CatalogContext;

export type DataHubFailureCode =
  | 'MCP_UNAVAILABLE'
  | 'DATASET_NOT_FOUND'
  | 'LINEAGE_INCOMPLETE'
  | 'WRITEBACK_FAILED';

export interface CatalogActivityEntry {
  seq: number;
  tool: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputSummary: string;
  outputSummary: string;
  status: 'OK' | 'ERROR';
  errorSanitized: string | null;
}

export class DataHubBridgeError extends Error {
  constructor(
    readonly failureState: DataHubFailureCode,
    message: string,
    readonly activityLog: CatalogActivityEntry[]
  ) {
    super(message);
    this.name = 'DataHubBridgeError';
  }
}
