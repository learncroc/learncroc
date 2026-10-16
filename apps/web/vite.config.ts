import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PORT = Number(process.env.LEARNCROC_PORT ?? 4747);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin stays false: the server's Host guard accepts localhost:5173 only under --dev.
      "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
