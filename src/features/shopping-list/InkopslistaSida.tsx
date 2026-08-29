import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { BigCheckbox } from '../../components/ui/form.tsx'
import { SHOPPING_CATEGORY_LABELS, SHOPPING_CATEGORY_ORDER } from '../../domain/types.ts'
import type { ShoppingCategory } from '../../domain/types.ts'
import { formatQuantity } from '../../domain/units.ts'
import { useAuth } from '../auth/auth-context.ts'
import { useProfil } from '../../hooks/useProfil.ts'
import { useRecept } from '../../hooks/useRecept.ts'
import { useVeckoplan } from '../../hooks/useVeckoplan.ts'
import { veckostart } from '../../services/mealPlans.ts'
import { hamtaSkafferi, tillPantryEntries } from '../../services/pantry.ts'
import {
  aterstallLista,
  genereraInkopslista,
  hamtaLista,
  kryssaPost,
  laggTillManuellPost,
  senasteOppnaLista,
  sattListStatus,
  taBortPost,
  uppdateraSumma,
} from '../../services/shoppingLists.ts'
import type { ShoppingListItemRow } from '../../types/database.ts'
import { cn, formatKr, formatKrRound } from '../../lib/utils.ts'
import { ProduktValjare } from './ProduktValjare.tsx'

interface ProduktSnapshot {
  name?: string
  descriptiveSize?: string
  sellingUnit?: 'PCE' | 'KGM'
  price?: number
  promotionNote?: string | null
  overbuy?: number | null
  syncedAt?: string
}

export function InkopslistaSida() {
  const { listId: listIdParam } = useParams()
  const navigera = useNavigate()
  const [sokparametrar, sattSokparametrar] = useSearchParams()
  const klient = useQueryClient()
  const { user } = useAuth()

  const { profil, portioner } = useProfil()
  const { data: recept } = useRecept()
  const weekStart = veckostart()
  const { data: plan } = useVeckoplan(weekStart)

  const [barKvarvarande, setBarKvarvarande] = useState(false)
  const [valjPost, setValjPost] = useState<ShoppingListItemRow | null>(null)
  const [nyPost, setNyPost] = useState('')
  const [fel, setFel] = useState<string | null>(null)

  const aktivLista = useQuery({
    queryKey: ['aktivlista', user?.id, listIdParam],
    queryFn: async () => {
      if (listIdParam) return hamtaLista(listIdParam)
      const senaste = await senasteOppnaLista(user!.id)
      return senaste ? hamtaLista(senaste.id) : null
    },
    enabled: Boolean(user?.id),
  })

  const generera = useMutation({
    mutationFn: async () => {
      if (!user || !profil || !recept) throw new Error('Uppgifter saknas.')

      const receptPerId = new Map(recept.map((item) => [item.id, item]))
      const maltider = (plan?.poster ?? [])
        .filter((post) => post.meal_type === 'dinner' && post.recipe_id)
        .map((post) => {
          const recipe = receptPerId.get(post.recipe_id!)
          return recipe
            ? { recipe, servings: post.servings, slotId: `${post.served_on}/dinner` }
            : null
        })
        .filter((meal): meal is NonNullable<typeof meal> => meal !== null)

      if (maltider.length === 0) {
        throw new Error('Veckan innehåller inga måltider att handla för.')
      }

      const skafferi = tillPantryEntries(await hamtaSkafferi(user.id))
      return genereraInkopslista(user.id, profil, maltider, skafferi, {
        mealPlanId: plan?.plan.id ?? null,
        namn: `Vecka ${format(parseISO(weekStart), 'w', { locale: sv })}`,
      })
    },
    onSuccess: (resultat) => {
      setFel(null)
      navigera(`/inkopslista/${resultat.listId}`, { replace: true })
      void klient.invalidateQueries({ queryKey: ['aktivlista'] })
      void klient.invalidateQueries({ queryKey: ['listor'] })
    },
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Listan kunde inte skapas.'),
  })

  // Veckoplaneraren länkar hit med ?generera=1.
  useEffect(() => {
    if (sokparametrar.get('generera') !== '1') return
    if (!profil || !recept || !plan) return
    sattSokparametrar({}, { replace: true })
    generera.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profil, recept, plan])

  const kryssa = useMutation({
    mutationFn: (args: { id: string; kryssad: boolean }) => kryssaPost(args.id, args.kryssad),
    onMutate: async ({ id, kryssad }) => {
      // Optimistiskt: i butiken ska kryssrutan svara direkt, inte vänta på nätet.
      await klient.cancelQueries({ queryKey: ['aktivlista'] })
      const tidigare = klient.getQueryData(['aktivlista', user?.id, listIdParam])
      klient.setQueryData(['aktivlista', user?.id, listIdParam], (gammal: unknown) => {
        const data = gammal as Awaited<ReturnType<typeof hamtaLista>>
        if (!data) return gammal
        return {
          ...data,
          poster: data.poster.map((post) => (post.id === id ? { ...post, checked: kryssad } : post)),
        }
      })
      return { tidigare }
    },
    onError: (_error, _variabler, context) => {
      klient.setQueryData(['aktivlista', user?.id, listIdParam], context?.tidigare)
    },
  })

  const laggTill = useMutation({
    mutationFn: (namn: string) => laggTillManuellPost(aktivLista.data!.lista.id, namn),
    onSuccess: () => {
      setNyPost('')
      void klient.invalidateQueries({ queryKey: ['aktivlista'] })
    },
  })

  const taBort = useMutation({
    mutationFn: async (id: string) => {
      await taBortPost(id)
      if (aktivLista.data) await uppdateraSumma(aktivLista.data.lista.id)
    },
    onSuccess: () => klient.invalidateQueries({ queryKey: ['aktivlista'] }),
  })

  const aterstall = useMutation({
    mutationFn: () => aterstallLista(aktivLista.data!.lista.id),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['aktivlista'] }),
  })

  const avsluta = useMutation({
    mutationFn: () => sattListStatus(aktivLista.data!.lista.id, 'done'),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['aktivlista'] })
      void klient.invalidateQueries({ queryKey: ['listor'] })
      navigera('/historik')
    },
  })

  const grupper = useMemo(() => {
    const poster = aktivLista.data?.poster ?? []
    const synliga = barKvarvarande ? poster.filter((post) => !post.checked) : poster

    const perKategori = new Map<string, ShoppingListItemRow[]>()
    for (const post of synliga) {
      const lista = perKategori.get(post.category) ?? []
      lista.push(post)
      perKategori.set(post.category, lista)
    }

    const ordning = [...SHOPPING_CATEGORY_ORDER] as string[]
    return [...perKategori.entries()]
      .sort((a, b) => {
        const ai = ordning.indexOf(a[0])
        const bi = ordning.indexOf(b[0])
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      .map(([kategori, poster2]) => ({
        kategori,
        etikett: SHOPPING_CATEGORY_LABELS[kategori as ShoppingCategory] ?? 'Övrigt',
        // Kryssade poster sjunker till botten inom sin kategori.
        poster: [...poster2].sort((a, b) => {
          if (a.checked !== b.checked) return a.checked ? 1 : -1
          return a.sort_order - b.sort_order
        }),
      }))
  }, [aktivLista.data, barKvarvarande])

  if (aktivLista.isLoading) return <SidLaddning />

  const lista = aktivLista.data?.lista
  const poster = aktivLista.data?.poster ?? []
  const kvar = poster.filter((post) => !post.checked).length
  const kraverBeslut = poster.filter((post) => post.status !== 'ready' && !post.is_manual).length

  return (
    <>
      <SidHuvud
        rubrik="Inköpslista"
        underrubrik={
          lista
            ? `${poster.length} poster · ${kvar} kvar · uppskattat ${formatKrRound(Number(lista.estimated_total))}`
            : 'Ingen aktiv lista.'
        }
      />

      {fel ? (
        <Notis ton="fel" className="mb-4">
          {fel}
        </Notis>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button disabled={generera.isPending} onClick={() => generera.mutate()}>
          {generera.isPending ? 'Ärendet bereds…' : 'Skapa inköpslista från veckan'}
        </Button>
        {lista ? (
          <>
            <Button
              variant={barKvarvarande ? 'primary' : 'secondary'}
              onClick={() => setBarKvarvarande((v) => !v)}
              aria-pressed={barKvarvarande}
            >
              Visa bara kvarvarande
            </Button>
            <Button variant="secondary" onClick={() => aterstall.mutate()}>
              <RotateCcw className="size-4" aria-hidden />
              Återställ allt
            </Button>
          </>
        ) : null}
      </div>

      {!lista ? (
        <TomtLage
          rubrik="Ingen inköpslista är upprättad."
          beskrivning="Planera veckans middagar först, så räknar departementet ut vad som behöver inhandlas."
          action={<Button onClick={() => navigera('/vecka')}>Till min vecka</Button>}
        />
      ) : (
        <>
          {lista.items_without_price > 0 ? (
            <Notis ton="varning" titel="Summan är ofullständig" className="mb-4">
              {lista.items_without_price} {lista.items_without_price === 1 ? 'post' : 'poster'} saknar
              pris och ingår inte i uppskattningen.
            </Notis>
          ) : null}

          {kraverBeslut > 0 ? (
            <Notis ton="varning" className="mb-4">
              {kraverBeslut} {kraverBeslut === 1 ? 'post kräver' : 'poster kräver'} manuell
              handläggning. Välj produkt för att få med dem i summan.
            </Notis>
          ) : null}

          <div className="space-y-4">
            {grupper.map((grupp) => (
              <Card key={grupp.kategori}>
                <h2 className="border-b border-[var(--kant)] px-4 py-2.5 text-sm font-semibold">
                  {grupp.etikett}
                </h2>
                <ul>
                  {grupp.poster.map((post) => (
                    <PostRad
                      key={post.id}
                      post={post}
                      onKryssa={(kryssad) => kryssa.mutate({ id: post.id, kryssad })}
                      onValjProdukt={() => setValjPost(post)}
                      onTaBort={() => taBort.mutate(post.id)}
                    />
                  ))}
                </ul>
              </Card>
            ))}
          </div>

          <Card className="mt-4">
            <CardBody className="pt-4">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (nyPost.trim()) laggTill.mutate(nyPost.trim())
                }}
              >
                <input
                  value={nyPost}
                  onChange={(event) => setNyPost(event.target.value)}
                  placeholder="Lägg till egen vara, t.ex. toapapper"
                  aria-label="Lägg till egen vara"
                  className="min-h-11 flex-1 rounded-lg border border-[var(--kant)] bg-[var(--yta)] px-3 text-sm"
                />
                <Button type="submit" size="icon" aria-label="Lägg till">
                  <Plus className="size-4" />
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardBody className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div>
                <p className="text-sm text-[var(--text-dampad)]">Uppskattad summa</p>
                <p className="text-2xl font-semibold">{formatKr(Number(lista.estimated_total))}</p>
                {lista.oldest_data_at ? (
                  <p className="mt-1 text-xs text-[var(--text-dampad)]">
                    Priser hämtade {format(parseISO(lista.oldest_data_at), 'd MMM HH:mm', { locale: sv })}
                  </p>
                ) : null}
              </div>
              {profil?.weekly_budget ? (
                <BudgetRuta budget={Number(profil.weekly_budget)} planerat={Number(lista.estimated_total)} />
              ) : null}
              <Button variant="secondary" onClick={() => avsluta.mutate()}>
                Avsluta handlingen
              </Button>
            </CardBody>
          </Card>

          <p className="mt-4 text-xs text-[var(--text-dampad)]">
            Priser och lagerstatus speglar City Gross onlinesortiment vid senaste hämtningen, inte
            hyllan i butiken. Portioner: {portioner}.
          </p>
        </>
      )}

      {valjPost && profil ? (
        <ProduktValjare
          post={valjPost}
          storeNumber={profil.store_number ?? '3230'}
          onStang={() => setValjPost(null)}
          onSparad={() => {
            setValjPost(null)
            void klient.invalidateQueries({ queryKey: ['aktivlista'] })
          }}
        />
      ) : null}
    </>
  )
}

function BudgetRuta({ budget, planerat }: { budget: number; planerat: number }) {
  const kvar = budget - planerat
  const andel = Math.min(100, Math.round((planerat / budget) * 100))

  return (
    <div className="min-w-40">
      <div className="flex justify-between text-xs text-[var(--text-dampad)]">
        <span>Veckobudget</span>
        <span>{formatKrRound(budget)}</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--kant)]"
        role="progressbar"
        aria-valuenow={andel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Andel av veckobudgeten"
      >
        <div
          className={cn('h-full rounded-full', kvar < 0 ? 'bg-[var(--color-lingon)]' : 'bg-[var(--color-tall)]')}
          style={{ width: `${andel}%` }}
        />
      </div>
      <p className="mt-1 text-xs">
        {kvar >= 0 ? (
          <>
            Kvar: <strong>{formatKrRound(kvar)}</strong>
          </>
        ) : (
          <span className="text-[var(--color-lingon)]">
            Över budget med {formatKrRound(Math.abs(kvar))}
          </span>
        )}
      </p>
    </div>
  )
}

function PostRad({
  post,
  onKryssa,
  onValjProdukt,
  onTaBort,
}: {
  post: ShoppingListItemRow
  onKryssa: (kryssad: boolean) => void
  onValjProdukt: () => void
  onTaBort: () => void
}) {
  const snapshot = (post.product_snapshot ?? null) as ProduktSnapshot | null
  const behov =
    post.required_amount !== null && post.required_unit
      ? formatQuantity(Number(post.required_amount), post.required_unit)
      : null

  return (
    <li className="flex items-start gap-3 border-t border-[var(--kant)] px-4 py-3 first:border-t-0">
      <BigCheckbox
        checked={post.checked}
        onChange={onKryssa}
        label={`Markera ${post.display_name} som hämtad`}
      />

      <div className={cn('min-w-0 flex-1', post.checked && 'opacity-45')}>
        <p className={cn('font-medium leading-snug', post.checked && 'line-through')}>
          {post.display_name}
        </p>

        {snapshot?.name ? (
          <p className="mt-0.5 truncate text-sm text-[var(--text-dampad)]">
            {snapshot.sellingUnit === 'KGM'
              ? `${Number(post.buy_quantity ?? 0).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kg`
              : `${post.buy_quantity} × ${snapshot.descriptiveSize ?? ''}`}{' '}
            {snapshot.name}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-dampad)]">
          {behov ? <span>Behöver {behov}</span> : null}
          {post.match_confidence ? <SakerhetsMarke niva={post.match_confidence} /> : null}
          {snapshot?.promotionNote ? <Badge ton="positiv">{snapshot.promotionNote}</Badge> : null}
        </div>

        {post.warnings.length > 0 && !post.checked ? (
          <ul className="mt-1.5 space-y-0.5">
            {post.warnings.map((varning) => (
              <li key={varning} className="text-xs text-[var(--color-lingon)]">
                {varning}
              </li>
            ))}
          </ul>
        ) : null}

        {post.status !== 'ready' && !post.is_manual ? (
          <Button variant="secondary" size="sm" className="mt-2" onClick={onValjProdukt}>
            Välj produkt
          </Button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-medium tabular-nums">
          {post.line_total !== null ? formatKr(Number(post.line_total)) : '–'}
        </span>
        {post.is_manual ? (
          <button
            type="button"
            onClick={onTaBort}
            aria-label={`Ta bort ${post.display_name}`}
            className="text-[var(--text-dampad)] hover:text-[var(--color-lingon)]"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </li>
  )
}

function SakerhetsMarke({ niva }: { niva: string }) {
  if (niva === 'confirmed') return <Badge ton="positiv">Ditt val</Badge>
  if (niva === 'probable') return <Badge>Trolig match</Badge>
  if (niva === 'ambiguous') return <Badge ton="varning">Kräver handläggning</Badge>
  if (niva === 'unavailable') return <Badge ton="fel">Ingen produkt</Badge>
  return <Badge ton="okand">Okänd</Badge>
}
