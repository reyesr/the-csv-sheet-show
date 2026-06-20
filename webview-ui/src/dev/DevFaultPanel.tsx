import { createSignal, For, Show } from 'solid-js';
import { CsvLoadErrorReason } from '../../../src/shared/messages/errors';
import {
	countActiveFaults,
	createDefaultFaults,
	FAULT_TOGGLES,
	LOAD_ERROR_REASONS,
	type BooleanFaultKey,
	type EmulatorFaults
} from './emulatorFaults';

/**
 * Collapsible dev-only panel that drives the emulator's simulated extension errors. Each checkbox
 * flips one fault on the shared emulator (via `setFault`); a small reason picker chooses what a
 * simulated CSV load failure reports. Toggling a fault then exercising the matching webview action
 * (reload, edit, find, change format, scroll a filter) reproduces the corresponding error path.
 */
export function DevFaultPanel() {
	const [open, setOpen] = createSignal(false);
	const [faults, setFaults] = createSignal<EmulatorFaults>(readFaults());

	function readFaults(): EmulatorFaults {
		return globalThis.__csvSheetShowEmulator?.getFaults() ?? createDefaultFaults();
	}

	function update<K extends keyof EmulatorFaults>(key: K, value: EmulatorFaults[K]): void {
		globalThis.__csvSheetShowEmulator?.setFault(key, value);
		setFaults(current => ({ ...current, [key]: value }));
	}

	function reset(): void {
		const defaults = createDefaultFaults();
		for (const toggle of FAULT_TOGGLES) {
			globalThis.__csvSheetShowEmulator?.setFault(toggle.key, defaults[toggle.key]);
		}
		globalThis.__csvSheetShowEmulator?.setFault('loadErrorReason', defaults.loadErrorReason);
		setFaults(defaults);
	}

	const activeCount = () => countActiveFaults(faults());

	return (
		<div class="dev-faults" classList={{ 'dev-faults--active': activeCount() > 0 }}>
			<button type="button" class="dev-faults__summary" aria-expanded={open()} onClick={() => setOpen(value => !value)}>
				<span class="dev-faults__caret">{open() ? '▾' : '▸'}</span>
				<strong>Simulated extension errors</strong>
				<Show when={activeCount() > 0}>
					<span class="dev-faults__badge">{activeCount()} active</span>
				</Show>
				<span class="dev-muted">— inject I/O & host failures</span>
			</button>

			<Show when={open()}>
				<div class="dev-faults__panel">
					<For each={FAULT_TOGGLES}>
						{toggle => (
							<label class="dev-fault">
								<input
									type="checkbox"
									checked={faults()[toggle.key]}
									onChange={event => update(toggle.key as BooleanFaultKey, event.currentTarget.checked)}
								/>
								<span class="dev-fault__body">
									<span class="dev-fault__label">{toggle.label}</span>
									<span class="dev-fault__description dev-muted">{toggle.description}</span>
									<Show when={toggle.key === 'loadError'}>
										<label class="dev-fault__reason">
											Reason
											<select
												value={faults().loadErrorReason}
												disabled={!faults().loadError}
												onChange={event => update('loadErrorReason', event.currentTarget.value as CsvLoadErrorReason)}
											>
												<For each={LOAD_ERROR_REASONS}>
													{reason => <option value={reason.value}>{reason.label}</option>}
												</For>
											</select>
										</label>
									</Show>
								</span>
							</label>
						)}
					</For>
					<div class="dev-faults__actions">
						<button type="button" onClick={reset} disabled={activeCount() === 0}>Clear all</button>
					</div>
				</div>
			</Show>
		</div>
	);
}
