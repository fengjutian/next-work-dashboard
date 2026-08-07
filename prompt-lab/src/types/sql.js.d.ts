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
    run(sql: string, params?: unknown[] | Record<string, unknown>): Database;
    prepare(sql: string, params?: unknown[] | Record<string, unknown>): Statement;
  }

  interface Statement {
    bind(values?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    get(params?: unknown[] | Record<string, unknown>): unknown[];
    getAsObject(params?: unknown[] | Record<string, unknown>): Record<string, unknown>;
    run(values?: unknown[] | Record<string, unknown>): void;
    free(): boolean;
  }

  interface SqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer;
  }

  export type { Database, QueryExecResult, SqlJsStatic, SqlJsConfig };
  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
