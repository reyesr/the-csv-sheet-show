/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_WEBVIEW_FIXTURE_CSV?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
