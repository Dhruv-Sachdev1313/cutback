import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/barlow-condensed/600.css';
import { UploadApp } from './UploadApp';
import './upload.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UploadApp />
  </React.StrictMode>,
);
