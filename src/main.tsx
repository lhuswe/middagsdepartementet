import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App.tsx'
import './index.css'

/**
 * BrowserRouter med basename i stället för HashRouter.
 *
 * Hash-routing hade krockat med Supabase inloggningslänkar, som historiskt
 * lägger sessionen i URL-fragmentet. Vi kör PKCE (se lib/supabase.ts) och
 * löser djuplänkar på GitHub Pages med en 404.html som speglar index.html.
 */
const basename = import.meta.env.BASE_URL

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
