import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  // Matches both src/phase8/__tests__/*.test.ts and
  // src/phase8/services/__tests__/*.test.ts (and any other __tests__ folder
  // nested anywhere under src), without needing every folder listed by hand.
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

export default config;
