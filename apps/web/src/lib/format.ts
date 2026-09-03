const KIB = 1024;
const MIB = KIB * 1024;

/** Binary units, which is how SD-card capacity is discussed in practice. */
export function formatBytes(n: number): string {
	if (n < KIB) return `${n} B`;
	if (n < MIB) return `${(n / KIB).toFixed(1)} KiB`;
	return `${(n / MIB).toFixed(1)} MiB`;
}

/** Final path segment of a zip-internal or filesystem path. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
