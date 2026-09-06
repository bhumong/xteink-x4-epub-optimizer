export async function readFixture(name: string): Promise<Uint8Array<ArrayBuffer>> {
	const response = await fetch(`/fixtures/epubs/${name}/book.epub`);
	if (!response.ok) {
		throw new Error(`fixture ${name} missing: HTTP ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
