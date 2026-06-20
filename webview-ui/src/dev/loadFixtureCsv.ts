import { parseNaiveCsv } from './parseNaiveCsv';

const defaultFixtureUrl = '/test-data.csv';

export async function loadFixtureCsv(): Promise<string[][]> {
	const fixtureUrl = import.meta.env.VITE_WEBVIEW_FIXTURE_CSV ?? defaultFixtureUrl;
	const response = await fetch(fixtureUrl);

	if (!response.ok) {
		throw new Error(`Failed to load CSV fixture ${fixtureUrl}: ${response.status} ${response.statusText}`);
	}

	return parseNaiveCsv(await response.text());
}
