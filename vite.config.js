import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite.config.js
const proxyConfig = {
  "/api": { target: "http://localhost:3001", changeOrigin: true },
  "/player": { target: "http://localhost:3001", changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: proxyConfig,
    allowedHosts: ["kaya-garnetlike-salably.ngrok-free.dev"],
  },
  preview: {
    proxy: proxyConfig,
  },
});