import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    proxy: {
      '/api': { target: process.env.CRM_API_PROXY_TARGET ?? 'http://localhost:9180', changeOrigin: true },
      '/socket.io': { target: process.env.CRM_API_PROXY_TARGET ?? 'http://localhost:9180', ws: true },
    },
  },
});
