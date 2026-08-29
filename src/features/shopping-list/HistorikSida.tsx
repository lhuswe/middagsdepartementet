import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { useAuth } from '../auth/auth-context.ts'
import { hamtaListor } from '../../services/shoppingLists.ts'
import { formatKrRound } from '../../lib/utils.ts'

export function HistorikSida() {
  const { user } = useAuth()

  const listor = useQuery({
    queryKey: ['listor', user?.id],
    queryFn: () => hamtaListor(user!.id, 50),
    enabled: Boolean(user?.id),
  })

  const statistik = useMemo(() => {
    const rader = (listor.data ?? []).filter((rad) => rad.status !== 'archived')
    if (rader.length === 0) return null
    const summa = rader.reduce((total, rad) => total + Number(rad.estimated_total), 0)
    return {
      antal: rader.length,
      summa,
      snitt: summa / rader.length,
    }
  }, [listor.data])

  if (listor.isLoading) return <SidLaddning />

  return (
    <>
      <SidHuvud rubrik="Historik" underrubrik="Tidigare inköpslistor och vad de kostade." />

      {statistik ? (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap gap-x-8 gap-y-3 pt-4">
            <Nyckeltal etikett="Listor" varde={String(statistik.antal)} />
            <Nyckeltal etikett="Sammanlagt uppskattat" varde={formatKrRound(statistik.summa)} />
            <Nyckeltal etikett="Snitt per lista" varde={formatKrRound(statistik.snitt)} />
          </CardBody>
        </Card>
      ) : null}

      {(listor.data ?? []).length === 0 ? (
        <TomtLage
          rubrik="Inga listor är arkiverade."
          beskrivning="När du skapat och avslutat en inköpslista hamnar den här."
        />
      ) : (
        <Card>
          <ul>
            {(listor.data ?? []).map((rad) => (
              <li key={rad.id} className="border-t border-[var(--kant)] first:border-t-0">
                <Link
                  to={`/inkopslista/${rad.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--yta-dampad)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{rad.name}</span>
                    <span className="block text-sm text-[var(--text-dampad)]">
                      {format(parseISO(rad.created_at), "d MMMM yyyy", { locale: sv })}
                      {rad.items_without_price > 0 ? ` · ${rad.items_without_price} utan pris` : ''}
                    </span>
                  </span>
                  <StatusMarke status={rad.status} />
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatKrRound(Number(rad.estimated_total))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-4 text-xs text-[var(--text-dampad)]">
        Summorna är uppskattningar utifrån priserna vid genereringstillfället, inte kvitton.
      </p>
    </>
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
