import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { bootstrap } from './engine';
import './styles.css';

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const root = createRoot(document.getElementById('root')!);

// No top-level await here: the platform chunk is imported dynamically and
// depends on this module, so awaiting at the top level would deadlock.
bootstrap().then(
  () =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    ),
  (error: unknown) =>
    root.render(
      <div className="boot-error" role="alert">
        <h1>Orivue no pudo iniciarse</h1>
        <p>{error instanceof Error ? error.message : 'Error desconocido'}</p>
        <button onClick={() => window.location.reload()}>Reintentar</button>
      </div>,
    ),
);
