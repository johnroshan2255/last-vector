import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { hydrateServerPref } from './platform/server';

// saved LAN server address (native storage / localStorage) — cheap, and needed before the first online connect
void hydrateServerPref();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
