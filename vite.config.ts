import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages sert le site à la racine de son domaine.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
