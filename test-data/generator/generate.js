#!/usr/bin/env bun
import * as iconv from 'iconv-lite';
import { createWriteStream, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const FIRST_NAMES = [
	'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Elijah', 'Sophia', 'Mateo', 'Isabella', 'Lucas',
	'Mia', 'Mason', 'Amelia', 'Ethan', 'Harper', 'Logan', 'Evelyn', 'James', 'Abigail', 'Benjamin'
];

const LAST_NAMES = [
	'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore',
	'Taylor', 'Anderson', 'Thomas', 'Martin', 'Jackson', 'Thompson', 'White', 'Lopez', 'Lee', 'Walker'
];

const SUPPORTED_TYPES = ['uuid', 'id', 'first-name', 'last-name', 'text', 'integer', 'decimal'];
const TEXT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DEFAULT_SEED = 123456789;
let randomState = DEFAULT_SEED >>> 0;

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

async function main() {
	const config = parseArgs(process.argv.slice(2));
	await generateFiles(config);
}

async function generateFiles(config) {
	setRandomSeed(config.seed);
	const csvPath = withExtension(config.outputBase, '.csv');
	const jsonPath = withExtension(config.outputBase, '.json');
	const lineEnding = getLineEnding(config.lineEndingName);
	const stream = createWriteStream(csvPath);
	const mapping = [];
	let offset = 0;

	if (config.header !== null) {
		mapping.push(offset);
		offset += await writeEncodedLine(stream, config.header.map(header => quoteCell(header)).join(config.separator) + lineEnding, config.encoding);
	}

	for (let rowIndex = 1; rowIndex <= config.rowCount; rowIndex++) {
		const row = config.types
			.map(column => synthesizeCell(column, rowIndex, config.decimalSeparator))
			.join(config.separator);
		const isLastRow = rowIndex === config.rowCount;

		mapping.push(offset);
		offset += await writeEncodedLine(stream, row + (isLastRow ? '' : lineEnding), config.encoding);
	}

	await closeStream(stream);

	writeFileSync(jsonPath, JSON.stringify({
		source: `synthetic-data-generator:${relativeBasename(config.outputBase)}`,
		'row-count': mapping.length,
		'column-count': config.types.length,
		'has-header': config.header !== null,
		encoding: config.encoding,
		'line-ending': config.lineEndingName.toUpperCase(),
		'cell-separator': config.separator,
		'decimal-separator': config.decimalSeparator,
		seed: config.seed,
		mapping
	}, null, 4));
}

function synthesizeCell(column, rowIndex, decimalSeparator) {
	let value;

	switch (column.type) {
		case 'uuid':
			value = randomUuid();
			break;
		case 'id':
			value = String(rowIndex);
			break;
		case 'first-name':
			value = FIRST_NAMES[randomInt(FIRST_NAMES.length)];
			break;
		case 'last-name':
			value = LAST_NAMES[randomInt(LAST_NAMES.length)];
			break;
		case 'text':
			value = randomText(6 + randomInt(7));
			break;
		case 'integer':
			value = String(randomInt(10001));
			break;
		case 'decimal':
			value = (nextRandom() * 100).toFixed(2).replace('.', decimalSeparator);
			break;
		default:
			throw new Error(`Unsupported type: ${column.type}`);
	}

	return column.quoted ? quoteCell(value) : value;
}

function setRandomSeed(seed) {
	randomState = seed >>> 0;
}

function parseArgs(args) {
	const values = new Map();

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith('--')) {
			fail(`Unexpected argument: ${arg}`);
		}

		const key = arg.slice(2).replace(/:$/, '');
		const value = args[i + 1];
		if (value === undefined || value.startsWith('--')) {
			fail(`Missing value for --${key}`);
		}

		values.set(key, value);
		i += 1;
	}

	const header = values.has('header') ? parseCsvList(requireValue(values, 'header')) : null;
	const types = parseTypes(requireValue(values, 'types'));
	if (header !== null && header.length !== types.length) {
		fail(`--header has ${header.length} columns but --types has ${types.length}`);
	}

	const rowCount = parsePositiveInteger(values.get('row-count') ?? '1000', '--row-count');
	const encoding = values.get('encoding') ?? 'utf-8';
	const lineEndingName = parseLineEnding(values.get('line-ending') ?? 'lf');
	const separator = values.get('separator') ?? ',';
	const decimalSeparator = parseDecimalSeparator(values.get('decimal-separator') ?? '.');
	const outputBase = resolve(values.get('output') ?? 'synthetic-data');
	const seed = parseSeed(values.get('seed') ?? String(DEFAULT_SEED));

	if (separator.length === 0) {
		fail('--separator cannot be empty');
	}

	if (!iconv.encodingExists(encoding)) {
		fail(`Unsupported encoding: ${encoding}`);
	}

	return {
		header,
		types,
		rowCount,
		encoding,
		lineEndingName,
		separator,
		decimalSeparator,
		outputBase,
		seed
	};
}

function parseCsvList(value) {
	const items = [];
	let current = '';
	let quoted = false;

	for (let i = 0; i < value.length; i++) {
		const char = value[i];

		if (char === '"') {
			quoted = !quoted;
			continue;
		}

		if (char === ',' && !quoted) {
			items.push(current.trim());
			current = '';
			continue;
		}

		current += char;
	}

	items.push(current.trim());
	return items;
}

function parseTypes(value) {
	const rawItems = [];
	let current = '';
	let quoted = false;
	let itemQuoted = false;

	for (let i = 0; i < value.length; i++) {
		const char = value[i];

		if (char === '"') {
			quoted = !quoted;
			itemQuoted = true;
			continue;
		}

		if (char === ',' && !quoted) {
			rawItems.push(parseType(current, itemQuoted));
			current = '';
			itemQuoted = false;
			continue;
		}

		current += char;
	}

	rawItems.push(parseType(current, itemQuoted));
	return rawItems;
}

function parseType(value, quoted) {
	const type = value.trim();
	if (!SUPPORTED_TYPES.includes(type)) {
		fail(`Unsupported type: ${type}`);
	}

	return { type, quoted };
}

function quoteCell(value) {
	return `"${value.replace(/"/g, '""')}"`;
}

function randomText(length) {
	let value = '';
	for (let i = 0; i < length; i++) {
		value += TEXT_CHARS[randomInt(TEXT_CHARS.length)];
	}

	return value;
}

function randomInt(maxExclusive) {
	return Math.floor(nextRandom() * maxExclusive);
}

function nextRandom() {
	randomState = (1664525 * randomState + 1013904223) >>> 0;
	return randomState / 0x100000000;
}

function randomUuid() {
	const bytes = new Array(16);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = randomInt(256);
	}

	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = bytes.map(byte => byte.toString(16).padStart(2, '0'));
	return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

async function writeEncodedLine(stream, value, encoding) {
	const chunk = iconv.encode(value, encoding);
	if (!stream.write(chunk)) {
		await new Promise(resolve => stream.once('drain', resolve));
	}

	return chunk.length;
}

async function closeStream(stream) {
	await new Promise((resolve, reject) => {
		stream.once('error', reject);
		stream.end(resolve);
	});
}

function withExtension(outputBase, extension) {
	const currentExtension = extname(outputBase);
	return currentExtension.length === 0 ? outputBase + extension : outputBase.slice(0, -currentExtension.length) + extension;
}

function relativeBasename(outputBase) {
	return outputBase.slice(dirname(outputBase).length + 1);
}

function requireValue(values, key) {
	const value = values.get(key);
	if (value === undefined) {
		fail(`Missing required argument --${key}`);
	}

	return value;
}

function parsePositiveInteger(value, argName) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		fail(`${argName} must be a positive integer`);
	}

	return parsed;
}

function parseSeed(value) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		fail('--seed must be an integer');
	}

	return parsed >>> 0;
}

function parseLineEnding(value) {
	const normalized = value.toLowerCase();
	if (normalized === 'cr' || normalized === 'lf' || normalized === 'crlf') {
		return normalized;
	}

	fail('--line-ending must be one of cr, lf, crlf');
}

function parseDecimalSeparator(value) {
	if (value === '.' || value === ',') {
		return value;
	}

	fail('--decimal-separator must be . or ,');
}

function getLineEnding(lineEndingName) {
	switch (lineEndingName) {
		case 'cr':
			return '\r';
		case 'crlf':
			return '\r\n';
		case 'lf':
			return '\n';
		default:
			throw new Error(`Unsupported line ending: ${lineEndingName}`);
	}
}

function fail(message) {
	throw new Error(message);
}
