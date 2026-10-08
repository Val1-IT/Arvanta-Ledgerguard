import { assertAllowlistedCall } from './allowlist';
import type { OdooConnectionConfig, OdooJson2Transport } from './types';

const USER_AGENT = 'ledgerguard-odoo/0.3.0';

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const copy = { ...headers };
  if (copy.Authorization) {
    copy.Authorization = 'bearer [redacted]';
  }
  return copy;
}

export function createJson2Transport(config: OdooConnectionConfig): OdooJson2Transport {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  return async (model, method, body) => {
    assertAllowlistedCall(model, method);
    const headers: Record<string, string> = {
      Authorization: `bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': USER_AGENT
    };
    if (config.database) {
      headers['X-Odoo-Database'] = config.database;
    }
    const response = await fetch(`${baseUrl}/json/2/${model}/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text };
    }
    if (!response.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Odoo JSON-2 ${response.status}`;
      const error = new Error(message);
      (error as Error & { status?: number; safeHeaders?: Record<string, string> }).status = response.status;
      (error as Error & { safeHeaders?: Record<string, string> }).safeHeaders = redactHeaders(headers);
      throw error;
    }
    return parsed;
  };
}

export function guardedTransport(inner: OdooJson2Transport): OdooJson2Transport {
  return async (model, method, body) => {
    assertAllowlistedCall(model, method);
    return inner(model, method, body);
  };
}
