import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";

const disableClientMinifyPlugin = {
  name: "disable-client-minify",
  configEnvironment(name) {
    if (name !== "client") {
      return;
    }

    return {
      build: {
        minify: false,
        cssMinify: false
      }
    };
  }
};

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
      minify: false,
      cssMinify: false
    },
    plugins: [disableClientMinifyPlugin],
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
