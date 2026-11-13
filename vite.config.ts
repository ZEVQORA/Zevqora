import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { assertBuildIsolation } from './api/_lib/env-isolation.js';

// PUBLIC_* values are inlined into the browser bundle: a Vercel preview wired to
// the production Supabase project fails here instead of shipping that config.
assertBuildIsolation(process.env);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // PUBLIC_* values are public by definition (Supabase anon key, app URL).
  // Server-only secrets never carry this prefix and are never inlined.
  envPrefix: ['VITE_', 'PUBLIC_'],
  define: {
    __ZEVQORA_DEPLOY_ENV__: JSON.stringify(process.env.VERCEL_ENV || 'local'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Local API functions are served by `vercel dev`; forward /api there when it runs.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          supabase: ['@supabase/supabase-js'],
          motion: ['motion'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx,js}'],
  },
});
