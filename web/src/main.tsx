import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

async function boot() {
  // Dev-only in-memory API. `import.meta.env.DEV` is a compile-time `false` in production
  // builds, so this branch and the dynamic import are dropped by the bundler.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === '1') {
    const { installMockApi } = await import('./dev/mockApi');
    installMockApi();
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
