/**
 * packages/phase3-database/src/connection/MigrationRunner.ts
 * Artha AI — Phase 3
 *
 * Custom lightweight migration runner.
 * Reads SQL files from migrations/, runs them alphabetically,
 * and tracks execution state in the schema_migrations table.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';

export class MigrationRunner {
  private readonly migrationsDir: string;

  constructor(migrationsDir?: string) {
    this.migrationsDir = migrationsDir ?? path.join(__dirname, '../../migrations');
  }

  /**
   * Run all pending migrations.
   */
  async runMigrations(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
      // 1. Ensure migrations tracking table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name varchar(255) PRIMARY KEY,
          applied_at timestamptz DEFAULT now()
        );
      `);

      // 2. Fetch already applied migrations
      const { rows } = await client.query('SELECT name FROM schema_migrations');
      const applied = new Set(rows.map((r: { name: string }) => r.name));

      // 3. Scan migrations directory
      if (!fs.existsSync(this.migrationsDir)) {
        console.warn(`Migrations directory not found: ${this.migrationsDir}`);
        return;
      }

      const files = fs.readdirSync(this.migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      console.log(`Found ${files.length} migration files. ${applied.size} already applied.`);

      for (const file of files) {
        if (applied.has(file)) {
          continue;
        }

        console.log(`Applying migration: ${file}...`);
        const filePath = path.join(this.migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Execute migration within a single transaction
        await client.query('BEGIN');
        try {
          // Execute the migration SQL script
          await client.query(sql);
          // Record migration completion
          await client.query(
            'INSERT INTO schema_migrations (name) VALUES ($1)',
            [file]
          );
          await client.query('COMMIT');
          console.log(`Successfully applied ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Failed to apply migration ${file}:`, err);
          throw err;
        }
      }

      console.log('All migrations check complete.');
    } finally {
      client.release();
    }
  }

  /**
   * Rollback the last N migrations.
   */
  async rollback(pool: Pool, steps = 1): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name varchar(255) PRIMARY KEY,
          applied_at timestamptz DEFAULT now()
        );
      `);

      const { rows } = await client.query(
        'SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT $1',
        [steps]
      );

      if (rows.length === 0) {
        console.log('No migrations to rollback.');
        return;
      }

      console.log(`Rolling back ${rows.length} migration(s)...`);

      for (const row of rows) {
        const file = row.name;
        console.log(`Rolling back: ${file} (Note: rollback executes custom logic or deletes record)...`);
        
        // Since migrations are raw SQL files, automatic rollback isn't natively supported.
        // We delete the migration record, allowing the user to modify and re-run.
        // If a specific down migration file existed, we would run it.
        await client.query('BEGIN');
        try {
          await client.query('DELETE FROM schema_migrations WHERE name = $1', [file]);
          await client.query('COMMIT');
          console.log(`Deleted migration record for ${file} from history.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Failed rollback for ${file}:`, err);
          throw err;
        }
      }
    } finally {
      client.release();
    }
  }
}

// Runnable script entry point
if (require.main === module) {
  const host = process.env.PGHOST || 'localhost';
  const port = parseInt(process.env.PGPORT || '5432', 10);
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'postgres';
  const database = process.env.PGDATABASE || 'artha';

  const pool = new Pool({ host, port, user, password, database });
  const runner = new MigrationRunner();

  const isRollback = process.argv.includes('--rollback');
  const steps = isRollback ? parseInt(process.argv[process.argv.indexOf('--rollback') + 1] || '1', 10) : 0;

  (async () => {
    try {
      if (isRollback) {
        await runner.rollback(pool, steps);
      } else {
        await runner.runMigrations(pool);
      }
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('Migration Runner execution error:', err);
      await pool.end();
      process.exit(1);
    }
  })();
}
