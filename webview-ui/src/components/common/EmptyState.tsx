export function EmptyState(props: { message: string }) {
	return (
		<div class="flex h-full min-h-40 items-center justify-center px-4 text-center text-control text-fg-muted">
			<div class="rounded-sm border border-dashed border-border bg-chrome px-4 py-3 vscode-high-contrast:border-focus">
				{props.message}
			</div>
		</div>
	);
}
