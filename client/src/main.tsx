import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { applyBootTheme } from './config/themeBoot.js';
import { AppProviders } from './providers/AppProviders.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import App from './App.js';

// Paint the last-used palette before React mounts — kills the theme flash on
// full-page refresh (static CSS fallback → real theme after async bootstrap).
applyBootTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
);
