import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Cible du backend en développement (le proxy ci-dessous évite les soucis de CORS
// et permet d'utiliser le même chemin /api qu'en production).
const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // html2pdf.js importe "html2canvas" en dur, qui ne sait pas parser les couleurs
      // oklch() (palette par défaut de Tailwind v4) et fait échouer tout export PDF.
      // html2canvas-pro est un remplacement à API identique qui les supporte.
      { find: 'html2canvas', replacement: 'html2canvas-pro' },
      // Le fichier principal de html2pdf.js (dist/html2pdf.js) embarque ses propres copies de jsPDF (4.0.0)
      // et de DOMPurify (3.3.1), figées à sa publication : mettre à jour `jspdf` et `dompurify` dans le
      // verrou n'y changerait rien. Ses sources (src/), publiées dans le même paquet, importent `jspdf` et
      // `dompurify` : le bundle prend alors les versions du verrou, que `npm audit` contrôle.
      { find: /^html2pdf\.js$/, replacement: 'html2pdf.js/src/index.js' },
    ],
  },
  server: {
    proxy: {
      '/api': { target: devApiTarget, changeOrigin: true },
      '/uploads': { target: devApiTarget, changeOrigin: true },
    },
  },
})
