import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './desktop.css';
import { initializeDesktop } from './desktop-client';
import { Island } from './Island';
async function start() {
  await initializeDesktop();
  const island = !!window.daylight && location.hash === '#island';
  if (window.daylight) document.body.classList.add('desktop-document');
  if (island) document.body.classList.add('island-document');
  createRoot(document.getElementById('root')!).render(<React.StrictMode>{island ? <Island/> : <App/>}</React.StrictMode>);
}
void start().catch(() => { document.getElementById('root')!.textContent = 'Không khởi tạo được Daylight. Hãy đóng và mở lại ứng dụng.'; });
