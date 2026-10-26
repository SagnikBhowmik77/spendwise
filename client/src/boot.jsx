import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import '@fontsource-variable/inter';
// Devanagari for Hindi; the browser only downloads it when Hindi text is on screen.
import '@fontsource-variable/noto-sans-devanagari';
import './index.css';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { SpaceProvider } from './context/SpaceContext.jsx';
import { registerServiceWorker } from './lib/pwa.js';
import { applyDisplay, applyPrivacy, privacyOn } from './lib/prefs.js';
import { language } from './lib/i18n.js';

applyPrivacy(privacyOn());
applyDisplay();
document.documentElement.lang = language();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry only when the server or network failed, never on 4xx answers.
      retry: (count, err) => count < 2 && (err.status === 0 || err.status >= 500),
    },
    // Saves are sent even when the browser says it is offline: a new entry that can't reach the server then
    // goes to the offline queue (batch 12Q) instead of waiting silently.
    mutations: { networkMode: 'always' },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <SpaceProvider>
              <ErrorBoundary fullScreen><App /></ErrorBoundary>
            </SpaceProvider>
            <Toaster
              position="top-center"
              toastOptions={{
                // Quiet surface, layered shadow, money colours only for the success / error marks.
                className: '!rounded-xl !bg-white !px-3.5 !py-2.5 !text-sm !font-medium !text-slate-900 !shadow-lg !ring-1 !ring-slate-900/[0.06] dark:!bg-slate-800 dark:!text-slate-100 dark:!ring-white/10',
                success: { iconTheme: { primary: 'oklch(0.6 0.13 160)', secondary: 'white' } },
                error: { iconTheme: { primary: 'oklch(0.6 0.16 18)', secondary: 'white' } },
                duration: 3500,
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

registerServiceWorker();
