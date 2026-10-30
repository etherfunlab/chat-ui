/** The slice of a pg Pool / client the data helpers need; PGlite fits too. */
export interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}
