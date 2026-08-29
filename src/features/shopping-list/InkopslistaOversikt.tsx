import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { Plus, ShoppingCart, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { TextField } from '../../components/ui/form.tsx'
import { useAuth } from '../auth/auth-context.ts'
import { useHushall, useHushallsallergier } from '../../hooks/useHushall.ts'
import { useRecept } from '../../hooks/useRecept.ts'
import { useVeckoplan } from '../../hooks/useVeckoplan.ts'
import { veckostart } from '../../services/mealPlans.ts'
import { hamtaSkafferi, tillPantryEntries } from '../../services/pantry.ts'
import {
  genereraInkopslista,
  hamtaListor,
  nastaListnamn,
  skapaTomLista,
  taBortLista,
} from '../../services/shoppingLists.ts'
import { formatKrRound } from '../../lib/utils.ts'

/**
 * Översikt över hushållets inköpslistor.
 *
 * Det här är vad `/inkopslista` visar. Tidigare hoppade den rakt in i senaste
 * *öppna* listan, vilket gjorde alla andra oåtkomliga tills man avslutat den
 * man stod i. Flera listor för samma vecka - en storhandling och en
 * kompletteringsrunda, säg - gick inte att skilja åt.
 */
export function InkopslistaOversikt() {
  const { user } = useAuth()
  const { hushall, hushallId } = useHushall()
  const { data: hushallsallergier } = useHushallsallergier()
  const { data: recept } = useRecept()
  const klient = useQueryClient()
  const navigera = useNavigate()
  const [sokparametrar, sattSokparametrar] = useSearchParams()

  const weekStart = veckostart()
  const { data: plan } = useVeckoplan(weekStart)

  const [nyttNamn, setNyttNamn] = useState('')
  const [skapar, setSkapar] = useState(false)
  const [taBortId, setTaBortId] = useState<string | null>(null)
  const [fel, setFel] = useState<string | null>(null)

  const listor = useQuery({
    queryKey: ['listor', hushallId],
    queryFn: () => hamtaListor(hushallId!, 50),
    enabled: Boolean(hushallId),
  })

  const skapa = useMutation({
    mutationFn: async () => {
      if (!hushall || !user) throw new Error('Uppgifter saknas.')
      const namn =
        nyttNamn.trim() ||
        (await nastaListnamn(
          hushall.id,
          `Vecka ${format(parseISO(veckostart()), 'w', { locale: sv })}`,
        ))
      return skapaTomLista(hushall, user.id, namn)
    },
    onSuccess: (listId) => {
      setFel(null)
      void klient.invalidateQueries({ queryKey: ['listor'] })
      navigera(`/inkopslista/${listId}`)
    },
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Listan kunde inte skapas.'),
  })

  /**
   * Skapar en lista ur veckans matsedel.
   *
   * Skriver aldrig över en befintlig lista. Vill man ha två för samma vecka -
   * en storhandling och en kompletteringsrunda - får de olika namn i stället.
   */
  const generera = useMutation({
    mutationFn: async () => {
      if (!user || !hushall || !recept) throw new Error('Uppgifter saknas.')

      const receptPerId = new Map(recept.map((item) => [item.id, item]))
      const maltider = (plan?.poster ?? [])
        .filter((post) => post.meal_type === 'dinner' && post.recipe_id)
        .map((post) => {
          const rätt = receptPerId.get(post.recipe_id!)
          return rätt
            ? { recipe: rätt, servings: post.servings, slotId: `${post.served_on}/dinner` }
            : null
        })
        .filter((meal): meal is NonNullable<typeof meal> => meal !== null)

      if (maltider.length === 0) {
        throw new Error('Veckan innehåller inga måltider att handla för.')
      }

      const skafferi = tillPantryEntries(await hamtaSkafferi(hushall.id))
      const namn = await nastaListnamn(
        hushall.id,
        `Vecka ${format(parseISO(weekStart), 'w', { locale: sv })}`,
      )

      return genereraInkopslista(hushall, user.id, hushallsallergier ?? [], maltider, skafferi, {
        mealPlanId: plan?.plan.id ?? null,
        namn,
      })
    },
    onSuccess: (resultat) => {
      setFel(null)
      void klient.invalidateQueries({ queryKey: ['listor'] })
      navigera(`/inkopslista/${resultat.listId}`)
    },
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Listan kunde inte skapas.'),
  })

  /*
   * Veckoplaneraren länkar hit med ?generera=1.
   *
   * Spärren behövs: effekten beror på frågeresultat vars identitet byts vid
   * omhämtning, och hann tidigare köra igen innan den rensade sökparametern
   * slagit igenom. Resultatet blev flera identiska listor inom samma sekund.
   */
  const genereringStartad = useRef(false)

  useEffect(() => {
    if (sokparametrar.get('generera') !== '1') return
    if (genereringStartad.current) return
    if (!hushall || !recept || !plan) return
    genereringStartad.current = true
    sattSokparametrar({}, { replace: true })
    generera.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hushall, recept, plan])

  const radera = useMutation({
    mutationFn: taBortLista,
    onSuccess: () => {
      setTaBortId(null)
      setFel(null)
      void klient.invalidateQueries({ queryKey: ['listor'] })
      void klient.invalidateQueries({ queryKey: ['aktivlista'] })
    },
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Listan kunde inte tas bort.'),
  })

  const rader = listor.data ?? []
  const pagaende = rader.filter((rad) => rad.status === 'open')
  const avslutade = rader.filter((rad) => rad.status !== 'open')

  /*
   * Statistiken räknar bara avslutade listor.
   *
   * En pågående lista är ännu inte en utgift, och att blanda in den hade gjort
   * snittet missvisande. Listor man ångrat tas bort på riktigt, så de påverkar
   * ingenting alls.
   */
  const statistik = useMemo(() => {
    if (avslutade.length === 0) return null
    const summa = avslutade.reduce((total, rad) => total + Number(rad.estimated_total), 0)
    return { antal: avslutade.length, summa, snitt: summa / avslutade.length }
  }, [avslutade])

  if (listor.isLoading) return <SidLaddning />

  return (
    <>
      <SidHuvud
        rubrik="Inköpslistor"
        underrubrik="Pågående och avslutade listor för hushållet."
        action={
          <Button onClick={() => setSkapar((v) => !v)}>
            <Plus className="size-4" aria-hidden />
            Ny lista
          </Button>
        }
      />

      {fel ? (
        <Notis ton="fel" className="mb-4">
          {fel}
        </Notis>
      ) : null}

      {skapar ? (
        <Card className="mb-4">
          <CardBody className="space-y-3 pt-4">
            <TextField
              label="Namn på listan"
              hint="Lämna tomt så föreslås veckans nummer. Flera listor kan finnas för samma vecka."
              placeholder="Storhandling"
              value={nyttNamn}
              onChange={(event) => setNyttNamn(event.target.value)}
            />
            <p className="text-sm text-[var(--text-dampad)]">
              En tom lista fylls med egna rader. Ur matsedeln räknas veckans middagar ut åt dig,
              med priser och förpackningar.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={generera.isPending} onClick={() => generera.mutate()}>
                {generera.isPending ? 'Ärendet bereds…' : 'Ur veckans matsedel'}
              </Button>
              <Button
                variant="secondary"
                disabled={skapa.isPending}
                onClick={() => skapa.mutate()}
              >
                {skapa.isPending ? 'Skapar…' : 'Tom lista'}
              </Button>
              <Button variant="ghost" onClick={() => setSkapar(false)}>
                Avbryt
              </Button>
            </div>
            <p className="text-xs text-[var(--text-dampad)]">
              Namnet gäller båda alternativen. Saknas matsedel för veckan, planera den under{' '}
              <Link to="/vecka" className="underline">Min vecka</Link> först.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {rader.length === 0 ? (
        <TomtLage
          rubrik="Ingen inköpslista är upprättad."
          beskrivning="Planera veckans middagar, så räknar departementet ut vad som behöver inhandlas. Eller börja med en tom lista."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigera('/vecka')}>Till min vecka</Button>
              <Button variant="secondary" onClick={() => setSkapar(true)}>
                Skapa tom lista
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-5">
          {pagaende.length > 0 ? (
            <Avsnitt rubrik="Pågående">
              {pagaende.map((rad) => (
                <Listrad
                  key={rad.id}
                  rad={rad}
                  framhavd
                  bekraftar={taBortId === rad.id}
                  raderar={radera.isPending}
                  onTaBort={() => setTaBortId(rad.id)}
                  onAvbryt={() => setTaBortId(null)}
                  onBekrafta={() => radera.mutate(rad.id)}
                />
              ))}
            </Avsnitt>
          ) : null}

          {avslutade.length > 0 ? (
            <Avsnitt rubrik="Avslutade">
              {avslutade.map((rad) => (
                <Listrad
                  key={rad.id}
                  rad={rad}
                  bekraftar={taBortId === rad.id}
                  raderar={radera.isPending}
                  onTaBort={() => setTaBortId(rad.id)}
                  onAvbryt={() => setTaBortId(null)}
                  onBekrafta={() => radera.mutate(rad.id)}
                />
              ))}
            </Avsnitt>
          ) : null}

          {statistik ? (
            <Card>
              <CardBody className="flex flex-wrap gap-x-8 gap-y-3 pt-4">
                <Nyckeltal etikett="Avslutade listor" varde={String(statistik.antal)} />
                <Nyckeltal
                  etikett="Sammanlagt uppskattat"
                  varde={formatKrRound(statistik.summa)}
                />
                <Nyckeltal etikett="Snitt per lista" varde={formatKrRound(statistik.snitt)} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--text-dampad)]">
        Summorna är uppskattningar utifrån priserna vid genereringstillfället, inte kvitton.
      </p>
    </>
  )
}

function Avsnitt({ rubrik, children }: { rubrik: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-[var(--text-dampad)]">{rubrik}</h2>
      <Card>
        <ul>{children}</ul>
      </Card>
    </section>
  )
}

interface ListradProps {
  rad: {
    id: string
    name: string
    status: 'open' | 'done' | 'archived'
    estimated_total: number
    items_without_price: number
    created_at: string
  }
  framhavd?: boolean
  bekraftar: boolean
  raderar: boolean
  onTaBort: () => void
  onAvbryt: () => void
  onBekrafta: () => void
}

function Listrad({
  rad,
  framhavd,
  bekraftar,
  raderar,
  onTaBort,
  onAvbryt,
  onBekrafta,
}: ListradProps) {
  return (
    <li className="border-t border-[var(--kant)] first:border-t-0">
      <div className="flex items-center gap-1 pr-2">
        <Link
          to={`/inkopslista/${rad.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-[var(--yta-dampad)]"
        >
          {framhavd ? (
            <ShoppingCart className="size-4 shrink-0 text-[var(--accent)]" aria-hidden />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{rad.name}</span>
            <span className="block text-sm text-[var(--text-dampad)]">
              {format(parseISO(rad.created_at), 'd MMMM yyyy', { locale: sv })}
              {rad.items_without_price > 0 ? ` · ${rad.items_without_price} utan pris` : ''}
            </span>
          </span>
          <StatusMarke status={rad.status} />
          <span className="shrink-0 font-medium tabular-nums">
            {formatKrRound(Number(rad.estimated_total))}
          </span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          aria-label={`Ta bort ${rad.name}`}
          onClick={onTaBort}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {bekraftar ? (
        <div className="border-t border-[var(--kant)] px-4 py-3">
          <Notis ton="fel" titel="Ta bort listan?">
            Listan och alla dess rader försvinner, och den räknas inte längre med i
            statistiken. Det går inte att ångra.
            <span className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" disabled={raderar} onClick={onBekrafta}>
                <TriangleAlert className="size-4" aria-hidden />
                {raderar ? 'Tar bort…' : 'Ja, ta bort'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onAvbryt}>
                Avbryt
              </Button>
            </span>
          </Notis>
        </div>
      ) : null}
    </li>
  )
}

function Nyckeltal({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-dampad)]">{etikett}</p>
      <p className="text-xl font-semibold">{varde}</p>
    </div>
  )
}

function StatusMarke({ status }: { status: 'open' | 'done' | 'archived' }) {
  if (status === 'open') return <Badge ton="varning">Pågående</Badge>
  if (status === 'done') return <Badge ton="positiv">Avslutad</Badge>
  return <Badge ton="okand">Arkiverad</Badge>
}
