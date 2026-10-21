/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * `import text from 'some/file.js?gzip'`: the file, gzipped and base64-encoded. Used for pdf.js, which is
 * large and only needed when a PDF is imported: compressed, it keeps the app (and the single file) small
 * and quick to start, and it is unpacked on first use.
 */
function gzipText(): Plugin {
  const suffix = '?gzip';
  return {
    name: 'assaycraft:gzip-text',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(suffix)) return null;
      const resolved = await this.resolve(source.slice(0, -suffix.length), importer, { skipSelf: true });
      return resolved ? resolved.id + suffix : null;
    },
    load(id) {
      // The dev server can add its own query (?v=…) to the id.
      if (!/[?&]gzip(&|$)/.test(id)) return null;
      const data = gzipSync(readFileSync(id.replace(/\?.*$/, '')), { level: 9 });
      return `export default ${JSON.stringify(data.toString('base64'))};`;
    },
  };
}

/**
 * Inlines the JS bundle and stylesheet into index.html so the whole app is a
 * single file that can be opened straight from disk (file://), fully offline.
 */
function inlineIntoHtml(): Plugin {
  return {
    name: 'assaycraft:inline-into-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlFile = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!htmlFile || htmlFile.type !== 'asset') return;
      // The app icons and manifest are separate files, which a single file opened from disk does not have.
      let html = String(htmlFile.source).replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '');
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          // With code splitting off, Vite leaves its "modules to preload" placeholder in dynamic imports; there is nothing to preload.
          const code = file.code.replace(/__VITE_PRELOAD__/g, 'void 0').replace(/<\/script/gi, '<\\/script');
          // Function replacer: the bundle may contain "$&"-like sequences.
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          const css = String(file.source).replace(/<\/style/gi, '<\\/style');
          html = html.replace(tag, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      htmlFile.source = html;
      htmlFile.fileName = 'assaycraft.html';
    },
  };
}

/**
 * The offline cache of the hosted app: emits sw.js (from src/offline/sw.js) with the list of built
 * files to keep, and a version that changes whenever any of them does, so browsers pick up updates.
 */
function offlineCache(): Plugin {
  let root = process.cwd();
  let publicDir = '';
  return {
    name: 'assaycraft:offline-cache',
    apply: 'build',
    // After Vite has added index.html to the bundle.
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const file of Object.values(bundle)) {
        // Source maps, and the host's deploy settings (.assetsignore, wrangler.json), are not part of the app.
        if (file.fileName.endsWith('.map') || isDeployFile(file.fileName)) continue;
        files.push(file.fileName);
        hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source);
      }
      for (const name of publicDir ? readdirSync(publicDir) : []) {
        const path = join(publicDir, name);
        if (!statSync(path).isFile() || isDeployFile(name)) continue;
        files.push(name);
        hash.update(name).update(readFileSync(path));
      }
      files.sort();
      const source = readFileSync(join(root, 'src/offline/sw.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

function isDeployFile(name: string) {
  return name.startsWith('.') || /^wrangler\.(json|jsonc|toml)$/.test(name);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    publicDir: single ? false : 'public',
    // pdf.js is only imported as compressed text (?gzip), never as a module.
    optimizeDeps: { entries: ['index.html'], exclude: ['pdfjs-dist'] },
    plugins: [gzipText(), react(), ...(single ? [inlineIntoHtml()] : [offlineCache()])],
    build: single
      ? {
          outDir: 'dist-single',
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 4000,
          rolldownOptions: { output: { codeSplitting: false } },
        }
      : { outDir: 'dist', chunkSizeWarningLimit: 2000 },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.ts'],
    },
  };
});
