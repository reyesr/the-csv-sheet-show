import { Show } from 'solid-js';
import type { EditController } from '../../types';
import { Button } from '../common/Button';
import { DeleteRowIcon, InsertAboveIcon, InsertBelowIcon } from '../common/icons';

export function EditionToolbar(props: {
	edit: EditController;
}) {
	function runAction(action: () => void): void {
		action();
		props.edit.focusGrid();
	}

	return (
		<div class="flex items-center gap-2">
			<Button
				icon={<InsertAboveIcon class="h-3.5 w-3.5" />}
				title="Insert row above"
				onMouseDown={event => event.preventDefault()}
				onClick={() => runAction(() => props.edit.insertRowAbove())}
			>
				Insert above
			</Button>
			<Button
				icon={<InsertBelowIcon class="h-3.5 w-3.5" />}
				title="Insert row below"
				onMouseDown={event => event.preventDefault()}
				onClick={() => runAction(() => props.edit.insertRowBelow())}
			>
				Insert below
			</Button>
			<Button
				icon={<DeleteRowIcon class="h-3.5 w-3.5" />}
				title="Delete the active row"
				onMouseDown={event => event.preventDefault()}
				onClick={() => runAction(() => props.edit.deleteActiveRow())}
			>
				Delete row
			</Button>
			<Show when={props.edit.statusMessage() !== ''}>
				<span class="px-1 text-label text-fg-muted">{props.edit.statusMessage()}</span>
			</Show>
		</div>
	);
}
