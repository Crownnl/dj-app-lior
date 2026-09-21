import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initNativeShell } from './native'
import './styles/theme.css'

void initNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
