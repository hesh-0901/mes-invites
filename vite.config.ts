import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages publie ce projet sous /mes-invites/ et non à la racine du domaine.
export default defineConfig({
  base: '/mes-invites/',
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
