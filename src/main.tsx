import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerOffline } from './lib/offline';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/sheet.css';
import './styles/buffer.css';
import './styles/plate.css';
import './styles/flow.css';
import './styles/stocks.css';
import './styles/history.css';
import './styles/seq.css';
import './styles/board.css';
import './styles/calendar.css';
import './styles/pdf.css';
import './styles/sync.css';
import './styles/mobile.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerOffline();
