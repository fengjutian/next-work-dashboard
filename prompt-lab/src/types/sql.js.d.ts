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

  interface SqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer;
  }

  export type { Database, QueryExecResult, SqlJsStatic, SqlJsConfig };
  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
