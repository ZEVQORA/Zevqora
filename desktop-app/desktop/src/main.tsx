import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

async function boot() {
  // Browser-only development aid; never part of a production bundle.
  if (import.meta.env.DEV && !window.zevqoraDesktop && new URLSearchParams(window.location.search).get('bridge') === 'mock') {
    await import('./dev/mockBridge')
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void boot()
