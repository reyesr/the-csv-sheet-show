import type { JSX } from 'solid-js';

/**
 * Curated inline icons (Design System §06): line marks on a 16×16 grid, ~1.5px stroke,
 * `currentColor` so they inherit text colour and theme, with round caps and joins. We keep
 * the custom-SVG approach (no Codicon font / CSP changes); the system reserves custom SVG
 * for the few marks the product needs in its dense chrome.
 */
export interface IconProps {
	/** Size / colour utilities. Defaults to `h-4 w-4`; colour comes from `currentColor`. */
	class?: string;
}

function Icon(props: { class?: string; children: JSX.Element }) {
	return (
		<svg
			viewBox="0 0 16 16"
			class={props.class ?? 'h-4 w-4'}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
}

export function SearchIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<circle cx="7" cy="7" r="4.5" />
			<line x1="10.5" y1="10.5" x2="14" y2="14" />
		</Icon>
	);
}

export function EditIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<path d="M2.5 11.5 11 3l2 2-8.5 8.5-2.7.7z" />
		</Icon>
	);
}

export function ExportIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<line x1="8" y1="2" x2="8" y2="10.5" />
			<path d="M4.5 7.5 8 11l3.5-3.5" />
			<line x1="3" y1="13.5" x2="13" y2="13.5" />
		</Icon>
	);
}

export function LockIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<rect x="3.5" y="7" width="9" height="6.5" rx="1" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
		</Icon>
	);
}

export function UnlockIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<rect x="3.5" y="7" width="9" height="6.5" rx="1" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-0.9" />
		</Icon>
	);
}

export function GearIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<circle cx="8" cy="8" r="1.6" />
			<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
		</Icon>
	);
}

export function InsertAboveIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<path d="M8 2.5v5" />
			<path d="M5.5 5 8 2.5 10.5 5" />
			<line x1="2.5" y1="10.5" x2="13.5" y2="10.5" />
			<line x1="2.5" y1="13.5" x2="13.5" y2="13.5" />
		</Icon>
	);
}

export function InsertBelowIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<line x1="2.5" y1="2.5" x2="13.5" y2="2.5" />
			<line x1="2.5" y1="5.5" x2="13.5" y2="5.5" />
			<path d="M8 8.5v5" />
			<path d="M5.5 11 8 13.5 10.5 11" />
		</Icon>
	);
}

export function DeleteRowIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<rect x="2.5" y="5.5" width="11" height="5" rx="1" />
			<line x1="5.5" y1="8" x2="10.5" y2="8" />
		</Icon>
	);
}

export function ColumnsIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
			<line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
			<line x1="8" y1="2.5" x2="8" y2="13.5" />
		</Icon>
	);
}

export function DatabaseIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<ellipse cx="8" cy="3.75" rx="5" ry="2" />
			<path d="M3 3.75v8.5c0 1.1 2.2 2 5 2s5-.9 5-2v-8.5" />
			<path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
		</Icon>
	);
}

export function SlidersIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<line x1="2.5" y1="4" x2="13.5" y2="4" />
			<line x1="2.5" y1="8" x2="13.5" y2="8" />
			<line x1="2.5" y1="12" x2="13.5" y2="12" />
			<circle cx="6" cy="4" r="1.6" />
			<circle cx="10" cy="8" r="1.6" />
			<circle cx="5" cy="12" r="1.6" />
		</Icon>
	);
}

export function CaretIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<path d="M4.5 6.5 8 10l3.5-3.5" />
		</Icon>
	);
}

export function CheckIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
		</Icon>
	);
}

export function CloseIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<line x1="4" y1="4" x2="12" y2="12" />
			<line x1="12" y1="4" x2="4" y2="12" />
		</Icon>
	);
}

export function InfoIcon(props: IconProps) {
	return (
		<Icon class={props.class}>
			<circle cx="8" cy="8" r="6.5" />
			<path d="M8 7.25v3.75" />
			<path d="M8 5h.01" />
		</Icon>
	);
}
