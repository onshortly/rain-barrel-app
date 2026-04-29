import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RainBarrelProvider } from './context/RainBarrelContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RainBarrelProvider>
    <App />
    </RainBarrelProvider>
  </StrictMode>,
)
