declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayBuffer | Uint8Array | null) => Database;
    (): Promise<SqlJsStatic>;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface Database {
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
    run(sql: string): Database;
  }

  export type { Database, QueryExecResult, SqlJsStatic };
  const initSqlJs: () => Promise<SqlJsStatic>;
  export default initSqlJs;
}
