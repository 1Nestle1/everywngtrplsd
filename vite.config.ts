import { resolve } from "node:path";
import { defineConfig } from "vite";

// Игра (index.html) и два технических демо: 2D (demo-2d.html) и 3D (3d.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        demo2d: resolve(__dirname, "demo-2d.html"),
        three: resolve(__dirname, "3d.html"),
      },
    },
  },
});
