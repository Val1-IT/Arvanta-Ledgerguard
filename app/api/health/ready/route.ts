import { databaseReady } from '../../../../src/db/readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const ready = await databaseReady();
  return Response.json({ ready }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' }
  });
}
