import mysql from "mysql2/promise";

const globalForMySql = globalThis as unknown as {
  mysqlPool?: mysql.Pool;
};

export function getPool() {
  if (!globalForMySql.mysqlPool) {
    globalForMySql.mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4"
    });
  }

  return globalForMySql.mysqlPool;
}

export async function queryRows<T>(sql: string, values: unknown[] = []) {
  const [rows] = await getPool().query(sql, values as never[]);
  return rows as T[];
}

export async function executeQuery(sql: string, values: unknown[] = []) {
  const [result] = await getPool().execute(sql, values as never[]);
  return result as mysql.ResultSetHeader;
}

// The pool-level helpers above each grab their own connection, so a sequence of
// them is a sequence of independent autocommitted statements — a multi-row write
// that fails halfway leaves the earlier rows committed. An order whose header
// inserted but whose line items did not is an order for nothing, and there was no
// way to undo it. This runs a group of statements on one connection inside a
// transaction: everything commits, or nothing does.
export type Tx = {
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  execute(sql: string, values?: unknown[]): Promise<mysql.ResultSetHeader>;
};

export async function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const tx: Tx = {
      async query<R>(sql: string, values: unknown[] = []) {
        const [rows] = await connection.query(sql, values as never[]);
        return rows as R[];
      },
      async execute(sql: string, values: unknown[] = []) {
        const [result] = await connection.execute(sql, values as never[]);
        return result as mysql.ResultSetHeader;
      }
    };
    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {
      /* the connection is already broken; the release below still returns it */
    });
    throw error;
  } finally {
    connection.release();
  }
}
