import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import './amplify-config';
import App from './App';
import Login from './pages/Login';
import Protected from './pages/Protected';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<App />} />
        <Route path='/login' element={<Login />} />
        <Route path='/protected' element={<Protected />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
