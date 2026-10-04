import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          framework: ["react", "react-dom", "react-router-dom"],
          primitives: ["@monitorx/ui"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
