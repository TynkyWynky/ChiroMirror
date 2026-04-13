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
