import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered after load so it never competes with the first paint or the
// initial GPS request. Dev is skipped — a cached shell there is only confusing.
// `?nosw` skips registration, for isolating the service worker when something
// only misbehaves in a production build.
const swDisabled = new URLSearchParams(location.search).has('nosw');

if ('serviceWorker' in navigator && import.meta.env.PROD && !swDisabled) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}
