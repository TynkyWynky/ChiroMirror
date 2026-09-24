import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
// Deterministic release identity, shared by client UI and the single service worker.
const buildHash = createHash("sha256");
for (const folder of ["src", "public", "netlify"]) {
  for (const file of readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`).sort()) buildHash.update(file.replaceAll("\\", "/")).update(readFileSync(file));
}
for (const file of ["package-lock.json", "astro.config.mjs"]) buildHash.update(readFileSync(file));
const appBuild = `app-${buildHash.digest("hex").slice(0,12)}`;

// CJS dependencies must stay native in development. Only the Lambda bundle
// needs this boundary inlined, because Lambda disables require(ESM).
const bundleSanitizerPlugin = {
  name: "bundle-server-sanitizer",
  apply: "build",
  config() {
    return { ssr: { noExternal: [
      "sanitize-html", "htmlparser2", "is-plain-object",
      "domhandler", "domutils", "domelementtype", "dom-serializer", "entities"
    ] } };
  }
};

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
    host: "127.0.0.1"
  },
  preview: {
    host: "127.0.0.1"
  },
  vite: {
    define: { "import.meta.env.PUBLIC_APP_BUILD": JSON.stringify(appBuild) },
    build: {
      // Work around a Linux-only esbuild minification failure on Netlify
      // while keeping the generated client bundle functionally identical.
      minify: false,
      cssMinify: false
    },
    plugins: [disableClientMinifyPlugin, bundleSanitizerPlugin],
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
  adapter: netlify({ devFeatures: false }),
  integrations: [preact()]
});
