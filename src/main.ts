import './app.css'
import App from './App.svelte'

// "ResizeObserver loop completed with undelivered notifications" is a benign
// browser-side quirk of any resize-driven layout (our virtualized grid trips
// it during load) — logging it must not blank the app.
window.addEventListener('error', (event) => {
    if (event.message?.includes('ResizeObserver loop')) {
        console.warn(event.message);
        return;
    }
    document.body.innerHTML = `<div style="color:red; padding:20px; font-family: monospace;"><h1>Error</h1><pre>${event.message}\n${event.filename}:${event.lineno}</pre></div>`;
    console.error(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    document.body.innerHTML = `<div style="color:red; padding:20px; font-family: monospace;"><h1>Promise Rejection</h1><pre>${event.reason}</pre></div>`;
    console.error(event.reason);
});

const app = new App({
    target: document.getElementById('app') as HTMLElement,
})

export default app
