import { render } from 'solid-js/web';
import { installWebviewEmulator } from './installWebviewEmulator';
import '../style.css';
import './devStyles.css';

installWebviewEmulator();

const root = document.getElementById('root');

if (root === null) {
	throw new Error('Missing webview root element');
}

const { DevWebviewContainer } = await import('./DevWebviewContainer');

render(() => <DevWebviewContainer />, root);
