import { createSignal, onMount } from 'solid-js';
import { App } from '../App';
import { DevFaultPanel } from './DevFaultPanel';
import { applyDevTheme, type DevTheme } from './devTheme';

const themes: DevTheme[] = ['dark', 'light', 'high-contrast'];

export function DevWebviewContainer() {
	const [theme, setTheme] = createSignal<DevTheme>('dark');
	const fixtureUrl = import.meta.env.VITE_WEBVIEW_FIXTURE_CSV ?? '/test-data.csv';

	onMount(() => applyDevTheme(theme()));

	function setNextTheme(nextTheme: DevTheme): void {
		setTheme(nextTheme);
		applyDevTheme(nextTheme);
	}

	return (
		<div class="dev-shell">
			<div class="dev-toolbar">
				<div class="dev-toolbar__group">
					<strong>Webview Emulator</strong>
					<span class="dev-muted">Fixture: {fixtureUrl}</span>
				</div>
				<div class="dev-toolbar__group">
					<label>
						Theme
						<select value={theme()} onChange={event => setNextTheme(event.currentTarget.value as DevTheme)}>
							{themes.map(themeName => <option value={themeName}>{themeName}</option>)}
						</select>
					</label>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.reloadFixture()}>Reload Fixture</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.sendCommand('showFind')}>Show Find</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.sendCommand('findNext')}>Find Next</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.sendCommand('findPrevious')}>Find Previous</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.sendCommand('closeFind')}>Close Find</button>
				</div>
				<div class="dev-toolbar__group">
					<span class="dev-muted">Editing (host-driven in production)</span>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.undo()}>Undo</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.redo()}>Redo</button>
					<button type="button" onClick={() => globalThis.__csvSheetShowEmulator?.save()}>Save (dev)</button>
				</div>
			</div>
			<DevFaultPanel />
			<App />
		</div>
	);
}
