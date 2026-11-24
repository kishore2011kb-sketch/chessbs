import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Local-only build for now: the dev server binds to 127.0.0.1.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
