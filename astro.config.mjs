import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";

// CJS dependencies must stay native in development. Only the Lambda bundle
// needs this boundary inlined, because Lambda disables require(ESM).
const bundleSanitizerPlugin = {
  name: "bundle-server-sanitizer",
  apply: "build",
  config() {
    return { ssr: { noExternal: [
      "sanitize-html", "htmlparser2", "is-plain-object",
      "domhandler", "domutils", "domelementtype", "dom-serializer", "entities",
      "deepmerge", "escape-string-regexp", "parse-srcset", "postcss", "launder", "dayjs",
      "picocolors", "source-map-js", "nanoid"
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
