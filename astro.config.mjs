import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";

export default defineConfig({
  site: "https://www.chironegenmanneke.be",
  server: {
    host: true
  },
  preview: {
    host: true
  },
  vite: {
    build: {
      // Work around a Linux-only esbuild minification failure on Netlify
      // while keeping the generated client bundle functionally identical.
      minify: false
    },
    server: {
      headers: {
        "Cache-Control": "no-store"
      }
    },
    preview: {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  },
  output: "server",
  adapter: netlify(),
  integrations: [preact()]
});
