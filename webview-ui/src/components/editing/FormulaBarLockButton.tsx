import { IconButton } from '../common/IconButton';
import { LockIcon, UnlockIcon } from '../common/icons';

export function FormulaBarLockButton(props: {
	locked: boolean;
	onToggle: () => void;
}) {
	return (
		<IconButton
			class="mt-0.5"
			icon={props.locked ? <LockIcon class="h-3.5 w-3.5" /> : <UnlockIcon class="h-3.5 w-3.5" />}
			title={props.locked
				? 'Auto-expansion locked: expands only while focused'
				: 'Auto-expansion unlocked: always expands to fit'}
			aria-pressed={props.locked}
			onMouseDown={event => event.preventDefault()}
			onClick={props.onToggle}
		/>
	);
}
