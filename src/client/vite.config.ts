import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname);
  const workspaceDir = path.resolve(__dirname, "../..");
  const loadedEnv = loadEnv(mode, workspaceDir, "");
  const apiPort = Number(loadedEnv.PORT || 5000);
  const apiTarget = loadedEnv.APP_URL || `http://localhost:${apiPort}`;

  return {
    plugins: [react()],
    root: rootDir,
    build: {
      outDir: "dist",
      emptyOutDir: true
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src")
      }
    },
    server: {
      port: 5173,
      proxy: {
        "/api": apiTarget
      }
    }
  };
});
