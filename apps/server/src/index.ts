import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';

/**
 * Static SPA host. No book processing happens here: the client owns the entire
 * pipeline, so adding an endpoint that touches EPUB data would violate the
 * product constraint in AGENTS.md rule 3.
 */
export function createApp(root: string) {
	const app = new Hono();

	app.get('/healthz', (c) => c.json({ ok: true }));

	// Hashed assets get long immutable caching. Vite emits them under /assets/,
	// so this rule is what keeps a redeploy from being blocked by stale caches.
	app.use(
		'/assets/*',
		serveStatic({
			root,
			// serveStatic() returns its Response directly, so context headers
			// added afterward are dropped; mutate the response object instead.
			onFound: (_path, c) =>
				c.res?.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
		})
	);
	app.use(serveStatic({ root, index: undefined }));

	// No client-side routing exists yet, so an unmatched path means either a bad
	// URL or a missing build. Saying so beats serving a confusing blank shell.
	app.get('*', (c) =>
		c.html(
			'<!doctype html><title>Xteink X4 EPUB Optimizer</title><p>Run npm run build -w apps/web first.</p>'
		)
	);

	return app;
}

const invokedAs = process.argv[1] ?? '';
const isMain = invokedAs.endsWith('src/index.ts') || invokedAs.endsWith('server/index.js');

if (isMain) {
	const port = Number(process.env.PORT ?? 3000);
	const root =
		process.env.STATIC_ROOT ?? fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
	serve({ fetch: createApp(root).fetch, port }, (info) => {
		console.log(`serving ${root} on http://localhost:${info.port}`);
	});
}
