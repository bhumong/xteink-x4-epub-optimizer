import { readFileSync, writeFileSync } from 'node:fs';

function readU16(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] << 24)
	);
}

function readInt32(bytes, offset) {
	const value = readU32(bytes, offset);
	return value > 0x7fffffff ? value - 0x100000000 : value;
}

function loadBmp(path) {
	const bytes = readFileSync(path);
	if (bytes.length < 54 || String.fromCharCode(bytes[0], bytes[1]) !== 'BM') {
		throw new Error(`${path}: not a BMP`);
	}
	const headerSize = readU32(bytes, 14);
	if (headerSize < 40) {
		throw new Error(`${path}: unsupported BMP header size ${headerSize}`);
	}
	const width = readInt32(bytes, 18);
	const heightRaw = readInt32(bytes, 22);
	if (width <= 0 || heightRaw === 0) {
		throw new Error(`${path}: unsupported dimensions ${width}x${heightRaw}`);
	}
	const height = Math.abs(heightRaw);
	const bottomUp = heightRaw > 0;
	const bpp = readU16(bytes, 28);
	const compression = readU32(bytes, 30);
	if (bpp !== 24 && bpp !== 32) {
		throw new Error(`${path}: unsupported bit depth ${bpp}`);
	}
	if (compression !== 0) {
		throw new Error(`${path}: unsupported compression ${compression}`);
	}
	const dataOffset = readU32(bytes, 10);
	const rowBytes = Math.ceil((width * bpp) / 32) * 4;
	const channels = bpp / 8;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const sourceY = bottomUp ? height - 1 - y : y;
		const rowStart = dataOffset + sourceY * rowBytes;
		for (let x = 0; x < width; x++) {
			const pixel = rowStart + x * channels;
			const target = (y * width + x) * 4;
			data[target] = bytes[pixel + 2]; // R
			data[target + 1] = bytes[pixel + 1]; // G
			data[target + 2] = bytes[pixel]; // B
			data[target + 3] = 255;
		}
	}
	return { width, height, data };
}

function main() {
	const [referencePath, actualPath, flag, flagValue] = process.argv.slice(2);
	if (!referencePath || !actualPath) {
		console.error('usage: compare-bmp.mjs <reference.bmp> <actual.bmp> [--report <path>]');
		process.exit(2);
	}
	let reportPath = null;
	if (flag === '--report' && flagValue) {
		reportPath = flagValue;
	}
	let reference;
	let actual;
	try {
		reference = loadBmp(referencePath);
		actual = loadBmp(actualPath);
	} catch (error) {
		console.error(String(error.message ?? error));
		process.exit(2);
	}
	if (reference.width !== actual.width || reference.height !== actual.height) {
		const message = `dimensions differ: reference ${reference.width}x${reference.height}, actual ${actual.width}x${actual.height}`;
		console.error(message);
		process.exit(1);
	}
	const { width, height } = reference;
	let differing = 0;
	let maxDiff = 0;
	let totalDiff = 0;
	for (let i = 0; i < width * height; i++) {
		const base = i * 4;
		for (let channel = 0; channel < 3; channel++) {
			const diff = Math.abs(reference.data[base + channel] - actual.data[base + channel]);
			if (diff > 0) differing++;
			if (diff > maxDiff) maxDiff = diff;
			totalDiff += diff;
		}
	}
	const report = {
		width,
		height,
		differingPixels: differing,
		maxChannelDiff: maxDiff,
		meanChannelDiff: Number((totalDiff / (width * height * 3)).toFixed(3)),
		identical: differing === 0
	};
	if (reportPath) {
		writeFileSync(reportPath, JSON.stringify(report, null, 2));
	}
	console.log(JSON.stringify(report));
	process.exit(report.identical ? 0 : 1);
}

main();
