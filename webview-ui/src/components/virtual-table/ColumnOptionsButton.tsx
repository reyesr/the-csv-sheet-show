import { cn } from '../../cn';
import { IconButton } from '../common/IconButton';
import { GearIcon } from '../common/icons';
import type { ColumnOptionsAnchorRect } from './types';

export function ColumnOptionsButton(props: {
	columnIndex: number;
	open: boolean;
	/** Extra classes — used by the header to reveal the gear on hover/focus (§08). */
	class?: string;
	onOpen: (columnIndex: number, anchorRect: ColumnOptionsAnchorRect) => void;
}) {
	function openOptions(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const button = event.currentTarget as HTMLButtonElement;
		const rect = button.getBoundingClientRect();
		props.onOpen(props.columnIndex, {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
			width: rect.width,
			height: rect.height
		});
	}

	return (
		<IconButton
			class={cn('absolute right-1 top-1/2 z-20 -translate-y-1/2', props.class)}
			icon={<GearIcon class="h-3.5 w-3.5" />}
			title={`Column ${props.columnIndex + 1} options`}
			active={props.open}
			aria-haspopup="dialog"
			aria-expanded={props.open}
			onMouseDown={event => event.preventDefault()}
			onClick={openOptions}
		/>
	);
}
