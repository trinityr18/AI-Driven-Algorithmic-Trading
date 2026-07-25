import { defineConfig } from "vite";

const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
