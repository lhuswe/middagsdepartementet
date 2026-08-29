import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout.tsx'
import { SidLaddning } from './components/ui/feedback.tsx'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import { useAuth } from './features/auth/auth-context.ts'
import { LoginPage } from './features/auth/LoginPage.tsx'
import { useHushall } from './hooks/useHushall.ts'
import { useProfil } from './hooks/useProfil.ts'

/*
 * Sidorna laddas var för sig. Appen används på mobil med butikstäckning, och
 * då är det som inte laddas det billigaste som finns. Översikten är den enda
 * som nästan alltid behövs och laddas därför direkt tillsammans med skalet.
 */
const OversiktSida = lazy(() =>
  import('./features/dashboard/OversiktSida.tsx').then((m) => ({ default: m.OversiktSida })),
)
const VeckaSida = lazy(() =>
  import('./features/meal-planner/VeckaSida.tsx').then((m) => ({ default: m.VeckaSida })),
)
const InkopslistaSida = lazy(() =>
  import('./features/shopping-list/InkopslistaSida.tsx').then((m) => ({
    default: m.InkopslistaSida,
  })),
)
const ReceptSida = lazy(() =>
  import('./features/recipes/ReceptSida.tsx').then((m) => ({ default: m.ReceptSida })),
)
const ReceptDetalj = lazy(() =>
  import('./features/recipes/ReceptDetalj.tsx').then((m) => ({ default: m.ReceptDetalj })),
)
const SkafferiSida = lazy(() =>
  import('./features/pantry/SkafferiSida.tsx').then((m) => ({ default: m.SkafferiSida })),
)
const ErbjudandenSida = lazy(() =>
  import('./features/deals/ErbjudandenSida.tsx').then((m) => ({ default: m.ErbjudandenSida })),
)
const HistorikSida = lazy(() =>
  import('./features/shopping-list/HistorikSida.tsx').then((m) => ({ default: m.HistorikSida })),
)
const InstallningarSida = lazy(() =>
  import('./features/settings/InstallningarSida.tsx').then((m) => ({
    default: m.InstallningarSida,
  })),
)
const AdminSida = lazy(() =>
  import('./features/admin/AdminSida.tsx').then((m) => ({ default: m.AdminSida })),
)
const OnboardingSida = lazy(() =>
  import('./features/onboarding/OnboardingSida.tsx').then((m) => ({ default: m.OnboardingSida })),
)
const HushallSida = lazy(() =>
  import('./features/household/HushallSida.tsx').then((m) => ({ default: m.HushallSida })),
)

const klient = new QueryClient({
  defaultOptions: {
    queries: {
      // Appen används i butik med skakig täckning. Hellre visa cachad data än
      // en tom skärm, och slippa hämta om vid varje fönsterbyte.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={klient}>
      <AuthProvider>
        <Rutter />
      </AuthProvider>
    </QueryClientProvider>
  )
}

function Rutter() {
  const { session, laddar } = useAuth()

  if (laddar) return <SidLaddning text="Kontrollerar behörighet." />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Suspense fallback={<SidLaddning />}>
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/valkommen" element={<OnboardingSida />} />
      <Route element={<SkyddadYta />}>
        <Route path="/" element={<OversiktSida />} />
        <Route path="/vecka" element={<VeckaSida />} />
        <Route path="/inkopslista" element={<InkopslistaSida />} />
        <Route path="/inkopslista/:listId" element={<InkopslistaSida />} />
        <Route path="/recept" element={<ReceptSida />} />
        <Route path="/recept/:receptId" element={<ReceptDetalj />} />
        <Route path="/skafferi" element={<SkafferiSida />} />
        <Route path="/erbjudanden" element={<ErbjudandenSida />} />
        <Route path="/historik" element={<HistorikSida />} />
        <Route path="/hushall" element={<HushallSida />} />
        <Route path="/installningar" element={<InstallningarSida />} />
        <Route path="/admin" element={<AdminSida />} />
      </Route>
      <Route path="*" element={<IckeFunnen />} />
    </Routes>
    </Suspense>
  )
}

/**
 * Innanför inloggningen. Skickar vidare till onboarding tills hushållet är
 * ifyllt - appen kan inte planera mat åt någon vars antal är okänt.
 */
function SkyddadYta() {
  const { profil, isLoading } = useProfil()
  const { saknarHushall, isLoading: hushallLaddar } = useHushall()

  if (isLoading || hushallLaddar) return <SidLaddning />

  // Utan hushåll finns ingen matsedel, inget skafferi och inga recept att visa.
  // Onboardingen skapar det, och tar även hand om den som lämnat sitt hushåll.
  if (profil && (!profil.onboarded_at || saknarHushall)) {
    return <Navigate to="/valkommen" replace />
  }

  return <Layout visaAdmin={profil?.is_admin ?? false} />
}

function IckeFunnen(): ReactNode {
  return (
    <main className="mx-auto max-w-md px-5 py-20 text-center">
      <h1 className="text-2xl font-semibold">Sidan är inte diarieförd</h1>
      <p className="mt-2 text-sm text-[var(--text-dampad)]">
        Adressen finns inte i departementets register.
      </p>
      <a href="./" className="mt-6 inline-block underline">
        Till översikten
      </a>
    </main>
  )
}
