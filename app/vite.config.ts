import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// A configuração (Supabase, servidores de rota, ambientes) continua num lugar só: js/config.js da raiz.
// Em desenvolvimento ela é servida em /config.js; no build vira o arquivo dist/config.js.
const CONFIG = fileURLToPath(new URL('../js/config.js', import.meta.url));
function configDaRaiz(): Plugin {
  return {
    name: 'config-da-raiz',
    configureServer(server) {
      server.middlewares.use('/config.js', (_req, res) => { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(readFileSync(CONFIG, 'utf8')); });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'config.js', source: readFileSync(CONFIG, 'utf8') }); }
  };
}

// base './': o mesmo build abre no navegador e no app desktop (Electron, endereço app://rrm/)
export default defineConfig({
  base: './',
  plugins: [react(), configDaRaiz()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5600 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom'], mapa: ['leaflet'], planilha: ['xlsx'], supabase: ['@supabase/supabase-js'] } }
    }
  }
});
