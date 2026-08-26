import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@': path.resolve(new URL('./src', import.meta.url).pathname)
    }
  }
});
