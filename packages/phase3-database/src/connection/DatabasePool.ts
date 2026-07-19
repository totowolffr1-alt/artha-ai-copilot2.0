/**
 * packages/phase3-database/src/connection/DatabasePool.ts
 * Artha AI — Phase 3
 *
 * Connection Pool configuration for PgBouncer-compatible connection pooling.
 * Three separate pools:
 *   1. Tick writer pool (3 connections, synchronous_commit = off)
 *   2. App pool (10 connections, synchronous_commit = on)
 *   3. Read-only pool (5 connections, points to replica/read-only)
 */

import { Pool, PoolConfig, PoolClient } from 'pg';

export interface ArthaPoolConfig extends PoolConfig {
  /** Enables synchronous_commit = off for high-throughput tick writes */
  isTickWriter?: boolean;
}

export class DatabasePool {
  /**
   * Helper to create a pool with standard defaults.
   * Forces timezone to UTC.
   */
  static createPool(config: ArthaPoolConfig): Pool {
    const poolConfig: PoolConfig = {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ...config,
    };

    const pool = new Pool(poolConfig);

    pool.on('connect', (client: PoolClient) => {
      // Force all connection timezone to UTC to keep DB timestamps clean
      client.query("SET TIME ZONE 'UTC'");

      if (config.isTickWriter) {
        // Rule 2: synchronous_commit = off for tick writer connection only
        client.query('SET synchronous_commit = off');
      }
    });

    pool.on('error', (err: Error, _client: PoolClient) => {
      console.error('Unexpected error on idle client', err);
    });

    return pool;
  }

  /**
   * Create the dedicated high-throughput tick writer pool.
   * Max 3 connections, sync commit off.
   */
  static createTickWriterPool(config: PoolConfig): Pool {
    return this.createPool({
      ...config,
      max: 3,
      isTickWriter: true,
    });
  }

  /**
   * Create the standard application pool.
   * Max 10 connections, sync commit on.
   */
  static createAppPool(config: PoolConfig): Pool {
    return this.createPool({
      ...config,
      max: 10,
      isTickWriter: false,
    });
  }

  /**
   * Create the read-only replica connection pool.
   * Max 5 connections.
   */
  static createReadReplicaPool(config: PoolConfig): Pool {
    return this.createPool({
      ...config,
      max: 5,
      isTickWriter: false,
    });
  }
}
