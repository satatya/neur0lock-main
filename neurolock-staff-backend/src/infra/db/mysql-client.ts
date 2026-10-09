import mysql, { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../../config/env';

const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // All DATETIME/TIMESTAMP values are UTC end to end; DATE columns stay plain 'YYYY-MM-DD' strings.
    timezone: 'Z',
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
});

pool.on('connection', (connection: any) => {
    connection.query("SET time_zone = '+00:00'");
});

export type Row = RowDataPacket & Record<string, any>;
export type DbExecutor = Pick<PoolConnection, 'query'>;

export async function query<T = Row>(sql: string, params: unknown[] = [], executor: DbExecutor = pool): Promise<T[]> {
    const [rows] = await executor.query<RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
}

export async function queryOne<T = Row>(sql: string, params: unknown[] = [], executor: DbExecutor = pool): Promise<T | null> {
    const rows = await query<T>(sql, params, executor);
    return rows.length > 0 ? rows[0] : null;
}

export async function execute(sql: string, params: unknown[] = [], executor: DbExecutor = pool): Promise<ResultSetHeader> {
    const [result] = await executor.query<ResultSetHeader>(sql, params);
    return result;
}

export async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function pingDatabase(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

/** MySQL returns JSON columns as objects, MariaDB as strings. */
export function parseJson<T = any>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }
    return value as T;
}

export default pool;
