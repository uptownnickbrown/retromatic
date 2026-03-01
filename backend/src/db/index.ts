import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://retromatic:retromatic_dev@localhost:5432/retromatic';

// For query purposes
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

// For migrations
export const migrationClient = postgres(connectionString, { max: 1 });

// Execute a raw SQL query in a read-only transaction with timeout and row limit.
// Used by the AI challenge builder's query_players tool.
export async function executeRawReadOnlyQuery(
  query: string,
  timeoutMs: number,
  maxRows: number,
): Promise<Record<string, unknown>[]> {
  const rows = await queryClient.begin('READ ONLY', async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = '${timeoutMs}'`);
    return await tx.unsafe(query);
  });
  return (rows as Record<string, unknown>[]).slice(0, maxRows);
}
