import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, resolveInitialTheme } from './theme/themePreference';

// 首帧前恢复主题，避免刷新时主题闪烁。
const initialTheme = resolveInitialTheme(typeof window !== 'undefined' ? window.localStorage : null);
applyTheme(document, initialTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
