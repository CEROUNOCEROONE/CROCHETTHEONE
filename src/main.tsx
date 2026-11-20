import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { applyAppTheme, getStoredThemeId } from './shared/theme/appTheme.ts';
import './index.css';

registerSW({
  immediate: true,
});

applyAppTheme(getStoredThemeId());

createRoot(document.getElementById('root')!).render(<App />);
