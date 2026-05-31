import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              priority: 3
            },
            {
              name: "antd-vendor",
              test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-[^\\/]+)[\\/]/,
              priority: 2,
              maxSize: 300 * 1024
            },
            {
              name: "vendor",
              test: /node_modules/,
              priority: 1,
              maxSize: 300 * 1024
            }
          ]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
