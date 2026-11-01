import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@/styles/globals.css';
import '@/styles/experience.css';
import '@/styles/engine.css';
import '@/styles/refinements.css';
import '@/styles/kinetic-experience.css';
import '@/styles/type-edition.css';
import '@/styles/unified.css';
import { App } from '@/App';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui/Toast';
import { loadConfig } from '@/lib/config';

void loadConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
