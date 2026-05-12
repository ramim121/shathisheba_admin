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
