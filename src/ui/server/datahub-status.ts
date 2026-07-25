export type DatahubUiStatus = 'CONNECTED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

/**
 * Lightweight UI-facing health probe. Does not use the MCP bridge or mutate DataHub.
 */
export async function probeDatahubStatus(): Promise<{ status: DatahubUiStatus; detail: string }> {
  const gmsUrl = process.env.DATAHUB_GMS_URL?.trim();
  if (!gmsUrl) {
    return { status: 'NOT_CONFIGURED', detail: 'DATAHUB_GMS_URL is not configured.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${gmsUrl.replace(/\/$/, '')}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store'
    }).finally(() => clearTimeout(timer));

    if (response.ok) {
      return { status: 'CONNECTED', detail: `GMS reachable at ${gmsUrl}` };
    }
    return {
      status: 'UNAVAILABLE',
      detail: `GMS responded HTTP ${response.status} from ${gmsUrl}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown GMS probe error';
    return { status: 'UNAVAILABLE', detail: message };
  }
}
