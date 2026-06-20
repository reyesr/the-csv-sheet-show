export type DevTheme = 'dark' | 'light' | 'high-contrast';

const themes: Record<DevTheme, Record<string, string>> = {
	dark: {
		'--vscode-editor-background': '#1e1e1e',
		'--vscode-foreground': '#cccccc',
		'--vscode-descriptionForeground': '#9d9d9d',
		'--vscode-panel-border': '#2b2b2b',
		'--vscode-sideBar-background': '#252526',
		'--vscode-input-background': '#3c3c3c',
		'--vscode-input-foreground': '#cccccc',
		'--vscode-input-border': '#3c3c3c',
		'--vscode-button-background': '#0e639c',
		'--vscode-button-foreground': '#ffffff',
		'--vscode-button-hoverBackground': '#1177bb',
		'--vscode-button-secondaryBackground': '#3a3d41',
		'--vscode-button-secondaryForeground': '#ffffff',
		'--vscode-button-secondaryHoverBackground': '#45494e',
		'--vscode-list-hoverBackground': '#2a2d2e',
		'--vscode-editorWidget-background': '#252526',
		'--vscode-editor-findMatchHighlightBackground': '#ea5c0055',
		'--vscode-editor-findMatchBackground': '#515c6a',
		'--vscode-editor-findMatchBorder': '#cca700',
		'--vscode-editor-foreground': '#cccccc',
		'--vscode-focusBorder': '#007fd4'
	},
	light: {
		'--vscode-editor-background': '#ffffff',
		'--vscode-foreground': '#333333',
		'--vscode-descriptionForeground': '#717171',
		'--vscode-panel-border': '#e5e5e5',
		'--vscode-sideBar-background': '#f3f3f3',
		'--vscode-input-background': '#ffffff',
		'--vscode-input-foreground': '#333333',
		'--vscode-input-border': '#cecece',
		'--vscode-button-background': '#007acc',
		'--vscode-button-foreground': '#ffffff',
		'--vscode-button-hoverBackground': '#0062a3',
		'--vscode-button-secondaryBackground': '#e5e5e5',
		'--vscode-button-secondaryForeground': '#333333',
		'--vscode-button-secondaryHoverBackground': '#d5d5d5',
		'--vscode-list-hoverBackground': '#f0f0f0',
		'--vscode-editorWidget-background': '#f3f3f3',
		'--vscode-editor-findMatchHighlightBackground': '#ea5c0055',
		'--vscode-editor-findMatchBackground': '#a8ac94',
		'--vscode-editor-findMatchBorder': '#b5200d',
		'--vscode-editor-foreground': '#333333',
		'--vscode-focusBorder': '#007acc'
	},
	'high-contrast': {
		'--vscode-editor-background': '#000000',
		'--vscode-foreground': '#ffffff',
		'--vscode-descriptionForeground': '#ffffff',
		'--vscode-panel-border': '#6fc3df',
		'--vscode-sideBar-background': '#000000',
		'--vscode-input-background': '#000000',
		'--vscode-input-foreground': '#ffffff',
		'--vscode-input-border': '#6fc3df',
		'--vscode-button-background': '#0f4a85',
		'--vscode-button-foreground': '#ffffff',
		'--vscode-button-hoverBackground': '#1f5a95',
		'--vscode-button-secondaryBackground': '#000000',
		'--vscode-button-secondaryForeground': '#ffffff',
		'--vscode-button-secondaryHoverBackground': '#1a1a1a',
		'--vscode-list-hoverBackground': '#1a1a1a',
		'--vscode-editorWidget-background': '#000000',
		'--vscode-editor-findMatchHighlightBackground': '#f3851855',
		'--vscode-editor-findMatchBackground': '#f38518',
		'--vscode-editor-findMatchBorder': '#ffffff',
		'--vscode-editor-foreground': '#ffffff',
		'--vscode-focusBorder': '#f38518'
	}
};

export function applyDevTheme(theme: DevTheme): void {
	const root = document.documentElement;
	const body = document.body;
	body.classList.toggle('vscode-light', theme === 'light');
	body.classList.toggle('vscode-dark', theme === 'dark');
	body.classList.toggle('vscode-high-contrast', theme === 'high-contrast');

	for (const [name, value] of Object.entries(themes[theme])) {
		root.style.setProperty(name, value);
	}
}
