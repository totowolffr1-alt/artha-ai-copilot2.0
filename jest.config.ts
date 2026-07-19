import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Widened for the monorepo restructure: 'src' covers the legacy flat
  // layout (phase8, etc.), 'packages' covers the newer packages/* modules
  // (phase10-copilot-intelligence, phase2-market-data, ...).
  roots: ['<rootDir>/src', '<rootDir>/packages'],
  // Matches any __tests__ folder nested anywhere under either root, without
  // needing every folder listed by hand.
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

export default config;