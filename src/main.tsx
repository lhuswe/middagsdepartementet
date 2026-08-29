import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App.tsx'
import { Felgrans, Felsida } from './components/Felgrans.tsx'
import { konfigurationsfel } from './lib/supabase.ts'
import './index.css'

/**
 * BrowserRouter med basename i stället för HashRouter.
 *
 * Hash-routing hade krockat med Supabase inloggningslänkar, som historiskt
 * lägger sessionen i URL-fragmentet. Vi kör PKCE (se lib/supabase.ts) och
 * löser djuplänkar på GitHub Pages med en 404.html som speglar index.html.
 */
const basename = import.meta.env.BASE_URL

const rot = createRoot(document.getElementById('root')!)

if (konfigurationsfel) {
  // Saknas konfigurationen går appen inte att starta. Det ska sägas rakt ut,
  // inte visas som en tom sida.
  rot.render(
    <Felsida
      rubrik="Appen är inte färdigkonfigurerad"
      beskrivning="Departementet når inte sin databas och kan därför inte visa något."
      detalj={konfigurationsfel}
    />,
  )
} else {
  rot.render(
    <StrictMode>
      <Felgrans>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </Felgrans>
    </StrictMode>,
  )
}
