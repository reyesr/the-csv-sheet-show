import { render } from 'solid-js/web';
import { App } from './App';
import './style.css';

const root = document.getElementById('root');

if (root === null) {
	throw new Error('Missing webview root element');
}

render(() => <App />, root);
