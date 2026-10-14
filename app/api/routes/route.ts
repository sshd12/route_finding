import { findRoutes, providerStatus } from '@/lib/providers';
import { parseRequest } from '@/lib/contracts';
import { connection } from 'next/server';
export async function GET() {
  await connection();
  return Response.json(providerStatus());
}
export async function POST(request: Request) {
  let input;
  try { input = parseRequest(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid routing request.' }, { status: 400 }); }
  if (!providerStatus().configured) return Response.json({ error: `Real routing needs server configuration: ${providerStatus().missing.join(', ')}.` }, { status: 503 });
  try { return Response.json(await findRoutes(input, undefined, request.signal)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Routing failed.' }, { status: 502 }); }
}
