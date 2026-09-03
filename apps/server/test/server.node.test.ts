import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';

let root: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'xteink-server-'));
	await mkdir(join(root, 'assets'), { recursive: true });
	await writeFile(join(root, 'index.html'), '<!doctype html><title>shell</title>');
	await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('createApp', () => {
	it('serves the SPA shell at /', async () => {
		const res = await createApp(root).request('/');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('shell');
	});

	it('serves a hashed asset with its content type', async () => {
		const res = await createApp(root).request('/assets/app.js');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('javascript');
	});

	it('marks assets as immutable', async () => {
		const res = await createApp(root).request('/assets/app.js');
		expect(res.headers.get('cache-control')).toContain('immutable');
	});

	it('reports health', async () => {
		const res = await createApp(root).request('/healthz');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('does not escape the served root', async () => {
		const res = await createApp(root).request('/../../etc/passwd');
		expect([200, 400, 403, 404]).toContain(res.status);
		expect(await res.text()).not.toContain('root:');
	});
});
