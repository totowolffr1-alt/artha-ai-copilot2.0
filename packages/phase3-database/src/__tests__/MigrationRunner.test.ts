import { MigrationRunner } from '../connection/MigrationRunner';
import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('pg');
jest.mock('fs');

describe('MigrationRunner Unit Tests', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;
  let runner: MigrationRunner;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    } as unknown as jest.Mocked<Pool>;

    runner = new MigrationRunner('/mock/migrations');
    jest.clearAllMocks();
  });

  it('should create schema_migrations table if not exists', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    await runner.runMigrations(mockPool);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations')
    );
  });

  it('should apply pending migrations in alphabetical order', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['002_enums.sql', '001_extensions.sql']);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.endsWith('001_extensions.sql')) return 'CREATE EXTENSION pgcrypto;';
      if (filePath.endsWith('002_enums.sql')) return 'CREATE TYPE my_enum AS ENUM (\'a\');';
      return '';
    });

    // Mock that schema_migrations already has nothing applied
    mockClient.query = jest.fn().mockImplementation((queryText: string, params?: any[]) => {
      if (queryText.includes('SELECT name FROM schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await runner.runMigrations(mockPool);

    // Verify transactions
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // Verify executions in correct order (001 first, then 002)
    const sqlQueries = (mockClient.query as jest.Mock).mock.calls.map((c: any) => c[0]);
    
    // First query should create tracking table, then select from it, then run migrations:
    const extensionsIndex = sqlQueries.findIndex((q: any) => q.includes('CREATE EXTENSION pgcrypto;'));
    const enumsIndex = sqlQueries.findIndex((q: any) => q.includes('CREATE TYPE my_enum AS ENUM'));
    
    expect(extensionsIndex).toBeGreaterThan(-1);
    expect(enumsIndex).toBeGreaterThan(-1);
    expect(extensionsIndex).toBeLessThan(enumsIndex);
  });
});
