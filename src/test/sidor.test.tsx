/**
 * Rendering av samtliga sidor.
 *
 * Sidorna bakom inloggningen går inte att klicka igenom utan ett konto, så det
 * här är nätet under dem: varje sida monteras med attrapper och måste rendera
 * något begripligt utan att kasta. Testerna fångar det vanligaste felet i en
 * app som den här - en komponent som antar att listan har rader, eller att ett
 * fält aldrig är null.
 *
 * De ersätter inte att någon faktiskt använder appen, och gör inte anspråk på
 * det. De ser till att första klicket inte möts av en vit skärm.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

import { AuthProvider } from '../features/auth/AuthProvider.tsx'
import { SEED_RECIPES } from '../domain/seed-recipes.ts'
import { skapaSupabaseAttrapp, TESTANVANDARE, TESTHUSHALL, TESTPROFIL } from './supabase-mock.ts'

const attrapp = vi.hoisted(() => ({ klient: null as ReturnType<typeof skapaSupabaseAttrapp> | null }))

vi.mock('../lib/supabase.ts', () => ({
  get supabase() {
    return attrapp.klient
  },
  appUrl: (path = '') => `http://localhost:5173${path}`,
}))

const RECEPTRAD = {
  id: 'recept-1',
  household_id: TESTHUSHALL.id,
  user_id: TESTANVANDARE.id,
  name: SEED_RECIPES[0]!.name,
  description: SEED_RECIPES[0]!.description,
  servings: 4,
  prep_minutes: 20,
  cook_minutes: 25,
  instructions: SEED_RECIPES[0]!.instructions,
  tags: SEED_RECIPES[0]!.tags,
  source: null,
  source_url: null,
  image_url: null,
  is_seed: true,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  recipe_ingredients: SEED_RECIPES[0]!.ingredients.map((item, index) => ({
    id: `ri-${index}`,
    recipe_id: 'recept-1',
    ingredient_id: item.ingredientId,
    quantity: item.quantity.value,
    unit: item.quantity.unit,
    optional: item.optional,
    note: null,
    sort_order: index,
  })),
}

const FULLT_DATASET: Record<string, unknown[]> = {
  profiles: [TESTPROFIL],
  households: [TESTHUSHALL],
  household_members: [
    {
      household_id: TESTHUSHALL.id,
      user_id: TESTANVANDARE.id,
      role: 'owner',
      joined_at: '2026-08-01T00:00:00.000Z',
    },
  ],
  household_invites: [],
  stores: [
    {
      store_number: '3230',
      name: 'City Gross Sundsvall',
      city: 'Sundsvall',
      street_address: 'Norra vägen 10',
      zip_code: '85009',
    },
  ],
  recipes: [RECEPTRAD],
  meal_plans: [],
  pantry_items: [
    {
      id: 'p1',
      household_id: TESTHUSHALL.id,
      user_id: TESTANVANDARE.id,
      ingredient_id: 'salt',
      amount: 500,
      min_stock: null,
      expires_on: null,
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  ],
  shopping_lists: [
    {
      id: 'lista-1',
      household_id: TESTHUSHALL.id,
      user_id: TESTANVANDARE.id,
      meal_plan_id: null,
      name: 'Vecka 35',
      store_number: '3230',
      status: 'open',
      estimated_total: 742.5,
      items_without_price: 1,
      oldest_data_at: '2026-08-28T03:00:00.000Z',
      generated_at: '2026-08-28T10:00:00.000Z',
      created_at: '2026-08-28T10:00:00.000Z',
      updated_at: '2026-08-28T10:00:00.000Z',
      shopping_list_items: [
        {
          id: 'post-1',
          shopping_list_id: 'lista-1',
          ingredient_id: 'blandfars',
          display_name: 'blandfärs',
          category: 'kott-fagel',
          required_amount: 1050,
          required_unit: 'g',
          buy_quantity: 3,
          product_gtin: '123',
          product_snapshot: {
            name: 'Blandfärs 50/50',
            descriptiveSize: '500G',
            sellingUnit: 'PCE',
            price: 45,
          },
          unit_price: 45,
          line_total: 135,
          match_confidence: 'probable',
          status: 'ready',
          warnings: [],
          checked: false,
          checked_at: null,
          is_manual: false,
          sort_order: 0,
        },
      ],
    },
  ],
  products: [],
  sync_runs: [],
  cooking_history: [],
  favorite_recipes: [],
  ingredient_product_mappings: [],
  favorite_products: [],
}

/**
 * Tomt läge: profil och hushåll finns, allt annat saknas.
 *
 * Här brukar krascherna finnas, och det är läget en ny användare möter direkt
 * efter onboardingen.
 */
const TOMT_DATASET: Record<string, unknown[]> = {
  profiles: [TESTPROFIL],
  households: [TESTHUSHALL],
  household_members: [
    {
      household_id: TESTHUSHALL.id,
      user_id: TESTANVANDARE.id,
      role: 'owner',
      joined_at: '2026-08-01T00:00:00.000Z',
    },
  ],
}

function rendera(element: ReactElement, sokvag = '/') {
  const klient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(
    <QueryClientProvider client={klient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[sokvag]}>
          <Routes>
            <Route path="/recept/:receptId" element={element} />
            <Route path="/inkopslista/:listId" element={element} />
            <Route path="*" element={element} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

/** Sidorna importeras dynamiskt så att attrappen hinner sättas först. */
const SIDOR: { namn: string; ladda: () => Promise<ReactElement>; sokvag?: string }[] = [
  {
    namn: 'Översikt',
    ladda: async () => {
      const { OversiktSida } = await import('../features/dashboard/OversiktSida.tsx')
      return <OversiktSida />
    },
  },
  {
    namn: 'Min vecka',
    ladda: async () => {
      const { VeckaSida } = await import('../features/meal-planner/VeckaSida.tsx')
      return <VeckaSida />
    },
  },
  {
    namn: 'Inköpslista',
    sokvag: '/inkopslista/lista-1',
    ladda: async () => {
      const { InkopslistaSida } = await import('../features/shopping-list/InkopslistaSida.tsx')
      return <InkopslistaSida />
    },
  },
  {
    namn: 'Recept',
    ladda: async () => {
      const { ReceptSida } = await import('../features/recipes/ReceptSida.tsx')
      return <ReceptSida />
    },
  },
  {
    namn: 'Receptdetalj',
    sokvag: '/recept/recept-1',
    ladda: async () => {
      const { ReceptDetalj } = await import('../features/recipes/ReceptDetalj.tsx')
      return <ReceptDetalj />
    },
  },
  {
    namn: 'Skafferi',
    ladda: async () => {
      const { SkafferiSida } = await import('../features/pantry/SkafferiSida.tsx')
      return <SkafferiSida />
    },
  },
  {
    namn: 'Erbjudanden',
    ladda: async () => {
      const { ErbjudandenSida } = await import('../features/deals/ErbjudandenSida.tsx')
      return <ErbjudandenSida />
    },
  },
  {
    namn: 'Historik',
    ladda: async () => {
      const { HistorikSida } = await import('../features/shopping-list/HistorikSida.tsx')
      return <HistorikSida />
    },
  },
  {
    namn: 'Inställningar',
    ladda: async () => {
      const { InstallningarSida } = await import('../features/settings/InstallningarSida.tsx')
      return <InstallningarSida />
    },
  },
  {
    namn: 'Diagnostik och tillsyn',
    ladda: async () => {
      const { AdminSida } = await import('../features/admin/AdminSida.tsx')
      return <AdminSida />
    },
  },
  {
    namn: 'Onboarding',
    ladda: async () => {
      const { OnboardingSida } = await import('../features/onboarding/OnboardingSida.tsx')
      return <OnboardingSida />
    },
  },
  {
    namn: 'Hushåll',
    ladda: async () => {
      const { HushallSida } = await import('../features/household/HushallSida.tsx')
      return <HushallSida />
    },
  },
  {
    namn: 'Inloggning',
    ladda: async () => {
      const { LoginPage } = await import('../features/auth/LoginPage.tsx')
      return <LoginPage />
    },
  },
]

let felIKonsolen: string[] = []

beforeEach(() => {
  felIKonsolen = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    felIKonsolen.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  // Utan globals registrerar Testing Library ingen automatisk städning, och då
  // ligger föregående sidas DOM kvar och förvirrar nästa test.
  cleanup()
  vi.restoreAllMocks()
})

describe.each([
  ['med data', FULLT_DATASET],
  ['utan data', TOMT_DATASET],
])('sidorna renderar %s', (_namn, dataset) => {
  for (const sida of SIDOR) {
    it(`${sida.namn} monteras utan att kasta`, async () => {
      attrapp.klient = skapaSupabaseAttrapp({
        tabeller: dataset,
        funktioner: { hushallets_allergier: [] },
      })

      const element = await sida.ladda()
      const { container } = rendera(element, sida.sokvag)

      // Vänta tills laddningsläget lämnats och något faktiskt renderats.
      await waitFor(() => {
        expect(container.textContent?.length ?? 0).toBeGreaterThan(20)
      })

      expect(felIKonsolen.join('\n')).not.toMatch(/Warning: Each child|not wrapped in act|Cannot read/i)
    })
  }
})

describe('nyckelsidor visar rätt sak', () => {
  beforeEach(() => {
    attrapp.klient = skapaSupabaseAttrapp({
      tabeller: FULLT_DATASET,
      funktioner: { hushallets_allergier: [] },
    })
  })

  it('inköpslistan visar produkten, mängden och summan', async () => {
    const { InkopslistaSida } = await import('../features/shopping-list/InkopslistaSida.tsx')
    rendera(<InkopslistaSida />, '/inkopslista/lista-1')

    await waitFor(() => expect(screen.getByText('blandfärs')).toBeTruthy())
    expect(screen.getByText(/Blandfärs 50\/50/)).toBeTruthy()
    expect(screen.getByText(/Behöver 1,05 kg/)).toBeTruthy()
    expect(screen.getAllByText(/135,00 kr/).length).toBeGreaterThan(0)
  })

  it('inköpslistan varnar när poster saknar pris', async () => {
    const { InkopslistaSida } = await import('../features/shopping-list/InkopslistaSida.tsx')
    rendera(<InkopslistaSida />, '/inkopslista/lista-1')

    await waitFor(() => expect(screen.getByText(/Summan är ofullständig/)).toBeTruthy())
  })

  it('veckan säger ifrån när ingen matsedel finns', async () => {
    attrapp.klient = skapaSupabaseAttrapp({
      tabeller: TOMT_DATASET,
      funktioner: { hushallets_allergier: [] },
    })
    const { VeckaSida } = await import('../features/meal-planner/VeckaSida.tsx')
    rendera(<VeckaSida />, '/vecka')

    await waitFor(() =>
      expect(screen.getByText(/Ingen matsedel är registrerad/)).toBeTruthy(),
    )
  })

  it('skafferiet listar det som lagerförts', async () => {
    const { SkafferiSida } = await import('../features/pantry/SkafferiSida.tsx')
    rendera(<SkafferiSida />, '/skafferi')

    await waitFor(() => expect(screen.getAllByText('salt').length).toBeGreaterThan(0))
  })
})
