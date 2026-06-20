import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: dirname,
	plugins: [solid(), tailwindcss()],
	base: './',
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
		cors: true,
		hmr: {
			host: '127.0.0.1',
			protocol: 'ws',
			clientPort: 5173
		}
	},
	build: {
		outDir: path.resolve(dirname, '../dist/webview'),
		emptyOutDir: true,
		manifest: 'manifest.json',
		rollupOptions: {
			input: path.resolve(dirname, 'index.html')
		}
	}
});
