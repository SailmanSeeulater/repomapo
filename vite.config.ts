/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // React gets a chunk of its own, so a deploy that only changes the app leaves it cached
    // (assets/ is served immutable; see deploy/nginx). The entry stays assets/index-<hash>.js,
    // which the deploy smoke test looks for.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
  },
})
