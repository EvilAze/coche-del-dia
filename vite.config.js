import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mantenemos outDir: 'build' para no romper el deploy actual de Vercel
// (estaba configurado implícitamente para el output de CRA).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build",
  },
  server: {
    port: 3000,
    open: true,
  },
});
