import { Show } from 'solid-js';
import type { CsvGridController, EditController } from '../../types';
import { Button } from '../common/Button';
import { EditIcon } from '../common/icons';

export function EditControls(props: {
	grid: CsvGridController;
	edit: EditController;
	/** True while a disclosure panel (Format / Export) is open, so Edit yields the single filled-primary slot. */
	panelOpen?: () => boolean;
}) {
	const editing = (): boolean => props.edit.isEditable();

	// One filled-primary per surface (§01): Edit is the command bar's primary, but while a Format
	// or Export panel is open that panel's action button owns the emphasis, so Edit drops to secondary.
	const variant = (): 'primary' | 'secondary' => (props.panelOpen?.() ? 'secondary' : 'primary');

	function toggleEditMode(): void {
		props.edit.requestEditMode(!editing());
		props.edit.focusGrid();
	}

	return (
		<Button
			variant="primary"
			icon={<Show when={!editing()}><EditIcon class="h-3.5 w-3.5" /></Show>}
			disabled={!props.grid.isFinal()}
			title={props.grid.isFinal()
				? (editing() ? 'Finish editing' : 'Edit the document')
				: 'Available once the file finishes loading'}
			onMouseDown={event => event.preventDefault()}
			onClick={toggleEditMode}
		>
			{editing() ? 'Done' : 'Edit'}
		</Button>
	);
}
