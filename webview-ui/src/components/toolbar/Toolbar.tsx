import { createSignal, Show } from 'solid-js';
import type { CsvGridController, EditController, FindController, SaveController } from '../../types';
import { EditionToolbar } from '../editing/EditionToolbar';
import { FormulaBar } from '../editing/FormulaBar';
import { FindBar } from '../find/FindBar';
import { Button } from '../common/Button';
import { TabButton } from '../common/TabButton';
import { SlidersIcon, ExportIcon, DatabaseIcon, SearchIcon } from '../common/icons';
import { StatusPanel } from './StatusPanel';
import { SaveProgressPanel } from './SaveProgressPanel';
import { EditControls } from './EditControls';
import { FormatPanel } from './FormatPanel';
import { ExportPanel } from './ExportPanel';
import { QueryPanel } from './QueryPanel';
import type { ExportController } from './createExportController';
import type { QueryController } from './query/createQueryController';

/**
 * The structural backbone (§08): one persistent command bar split into three stable zones —
 * Format (left), Find (center), Actions (right) — with disclosure panels and the contextual
 * edit band docking below it in document flow.
 */
export function Toolbar(props: {
	grid: CsvGridController;
	find: FindController;
	edit: EditController;
	save: SaveController;
	export: ExportController;
	tools: QueryController;
}) {
	// A single active-panel signal keeps the disclosure tabs mutually exclusive:
	// opening one closes the other, and they share the one slot below the bar.
	const [activePanel, setActivePanel] = createSignal<'format' | 'export' | 'query' | null>(null);
	const formatOpen = () => activePanel() === 'format';
	const exportPanelOpen = () => activePanel() === 'export';
	const queryOpen = () => activePanel() === 'query';

	function toggleFind(): void {
		if (props.find.findOpen()) {
			props.find.closeFindBar();
		} else {
			props.find.showFindBar();
		}
	}

	return (
		<div class="flex min-w-0 flex-col gap-2">
			<section class="flex min-w-0 items-center gap-3 rounded-sm border border-border bg-chrome px-3 py-1.5 vscode-high-contrast:border-focus">
				{/* LEFT · Format */}

				<EditControls grid={props.grid} edit={props.edit} panelOpen={() => formatOpen() || exportPanelOpen()} />

				<div class="flex items-center gap-2">
					<TabButton
						icon={<SlidersIcon class="h-3.5 w-3.5" />}
						open={formatOpen()}
						disabled={props.grid.csvConfig() === null || props.edit.isEditable()}
						title="Parsing options of the CSV file"
						onToggle={() => setActivePanel(panel => (panel === 'format' ? null : 'format'))}
					>
						Format
					</TabButton>

					<TabButton
						icon={<ExportIcon class="h-3.5 w-3.5" />}
						open={exportPanelOpen()}
						disabled={props.grid.csvConfig() === null || props.edit.isEditable()}
						title="Export file in a different format"
						onToggle={() => setActivePanel(panel => (panel === 'export' ? null : 'export'))}
					>
						Export
					</TabButton>

					<TabButton
						icon={<DatabaseIcon class="h-3.5 w-3.5" />}
						open={queryOpen()}
						disabled={props.grid.csvConfig() === null || props.edit.isEditable()}
						title="Run DuckDB with this file loaded"
						onToggle={() => setActivePanel(panel => (panel === 'query' ? null : 'query'))}
					>
						Query
					</TabButton>

				</div>

				{/* CENTER · Find */}
				<div class="flex flex-1 items-center justify-center">
					<Button
						icon={<SearchIcon class="h-3.5 w-3.5" />}
						aria-pressed={props.find.findOpen()}
						title="Find and filter rows"
						onMouseDown={event => event.preventDefault()}
						onClick={toggleFind}
					>
						Find
					</Button>
				</div>

				{/* RIGHT · Actions */}
				<div class="flex min-w-0 items-center gap-2">
					<Show when={props.save.progressVisible()}>
						<SaveProgressPanel percent={props.save.progressPercent} />
					</Show>
					<StatusPanel statsText={props.grid.statsText} />
				</div>
			</section>

			<Show when={formatOpen() && !props.edit.isEditable()}>
				<FormatPanel grid={props.grid} />
			</Show>

			<Show when={exportPanelOpen() && !props.edit.isEditable()}>
				<ExportPanel export={props.export} grid={props.grid} />
			</Show>

			<Show when={queryOpen() && !props.edit.isEditable()}>
				<QueryPanel tools={props.tools} grid={props.grid} />
			</Show>

			<Show when={props.find.findOpen()}>
				<FindBar find={props.find} headerCells={props.grid.headerCells()} columnCount={props.grid.maxColumnCount()} />
			</Show>

			{/* Contextual edit band (§08): present only while editing — its presence states the mode. */}
			<Show when={props.edit.isEditable()}>
				<div
					class="flex flex-col gap-2 rounded-sm border border-border bg-surface px-3 py-2 vscode-high-contrast:border-focus"
					style={{ 'border-left-width': '3px', 'border-left-color': 'var(--color-focus)' }}
				>
					<EditionToolbar edit={props.edit} />
					<FormulaBar edit={props.edit} />
				</div>
			</Show>
		</div>
	);
}
