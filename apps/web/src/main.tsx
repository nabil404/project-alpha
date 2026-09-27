import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
// Side-effect import: initializes the i18next singleton. Must stay ABOVE
// ./router — ESM evaluates in statement order, and no module body should be
// able to observe an uninitialized i18n.
import './i18n';
import { queryClient, router } from './router';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
