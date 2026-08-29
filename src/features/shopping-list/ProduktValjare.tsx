import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/button.tsx'
import { Notis, Spinner } from '../../components/ui/feedback.tsx'
import { getIngredient } from '../../domain/ingredients.ts'
import { calculatePrice } from '../../domain/promotions.ts'
import type { Product } from '../../domain/types.ts'
import { useAuth } from '../auth/auth-context.ts'
import { sokProdukter } from '../../services/catalog.ts'
import {
  bytProduktPaPost,
  sparaFavoritprodukt,
  sparaProduktval,
  uppdateraSumma,
} from '../../services/shoppingLists.ts'
import type { ShoppingListItemRow } from '../../types/database.ts'
import { cn, formatKr } from '../../lib/utils.ts'

/**
 * Produktväljaren.
 *
 * Öppnas när matchningen inte är säker nog. Poängen är inte bara att lösa den
 * här raden: valet sparas i `ingredient_product_mappings` och gör att samma
 * ingrediens blir `confirmed` nästa vecka. Det är så matchningen blir bättre
 * över tid — genom återkoppling, inte genom en smartare algoritm.
 */
export function ProduktValjare({
  post,
  storeNumber,
  onStang,
  onSparad,
}: {
  post: ShoppingListItemRow
  storeNumber: string
  onStang: () => void
  onSparad: () => void
}) {
  const { user } = useAuth()
  const ingredient = post.ingredient_id ? getIngredient(post.ingredient_id) : undefined
  const [fraga, setFraga] = useState(ingredient?.name ?? post.display_name)
  const [somFavorit, setSomFavorit] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const traffar = useQuery({
    queryKey: ['produktsok', storeNumber, fraga],
    queryFn: () => sokProdukter(fraga, storeNumber),
    enabled: fraga.trim().length >= 2,
  })

  const valj = useMutation({
    mutationFn: async (produkt: Product) => {
      if (!user || !post.ingredient_id) throw new Error('Uppgifter saknas.')

      const behov = Number(post.required_amount ?? 0)
      const storlek = produkt.netContent?.value ?? 0

      // Antalet räknas ut här i stället för att gissas: styckvara avrundas upp
      // till hela förpackningar, lösvikt begär exakt den mängd som behövs.
      const antal =
        produkt.sellingUnit === 'KGM'
          ? Math.max(0.01, Math.ceil(behov / 10) / 100)
          : Math.max(1, Math.ceil(behov / (storlek > 0 ? storlek : behov || 1)))

      const pris = calculatePrice(produkt, antal, { at: new Date() })

      await sparaProduktval(user.id, post.ingredient_id, storeNumber, produkt.gtin)
      if (somFavorit) {
        await sparaFavoritprodukt(user.id, post.ingredient_id, storeNumber, produkt.gtin)
      }
      await bytProduktPaPost(post.id, produkt, antal, pris.total)
      await uppdateraSumma(post.shopping_list_id)
    },
    onSuccess: onSparad,
  })

  return (
    <dialog
      ref={dialog}
      onClose={onStang}
      aria-label={`Välj produkt för ${post.display_name}`}
      className="m-0 h-dvh max-h-dvh w-dvw max-w-dvw bg-transparent p-0 backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[85vh] sm:w-[32rem] sm:max-w-[92vw]"
    >
      <div className="flex h-full flex-col overflow-hidden bg-[var(--yta)] text-[var(--text)] sm:rounded-xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--kant)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{post.display_name}</h2>
            <p className="text-sm text-[var(--text-dampad)]">
              {post.required_amount !== null
                ? `Behöver ${Number(post.required_amount).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} ${post.required_unit}`
                : 'Välj produkt'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
            Stäng
          </Button>
        </header>

        <div className="border-b border-[var(--kant)] px-4 py-3">
          <input
            value={fraga}
            onChange={(event) => setFraga(event.target.value)}
            aria-label="Sök produkt"
            placeholder="Sök i sortimentet"
            className="min-h-11 w-full rounded-lg border border-[var(--kant)] bg-[var(--yta)] px-3 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={somFavorit}
              onChange={(event) => setSomFavorit(event.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Använd alltid den här produkten för {ingredient?.name ?? post.display_name}
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {traffar.isLoading ? (
            <div className="p-6 text-center">
              <Spinner />
            </div>
          ) : null}

          {traffar.data && traffar.data.length === 0 ? (
            <Notis ton="neutral" className="m-4">
              Inga produkter i den synkade katalogen matchar sökningen. Prova ett annat ord, eller
              lägg till varan manuellt på listan.
            </Notis>
          ) : null}

          <ul>
            {(traffar.data ?? []).map((produkt) => (
              <li key={produkt.gtin}>
                <button
                  type="button"
                  disabled={valj.isPending}
                  onClick={() => valj.mutate(produkt)}
                  className={cn(
                    'flex w-full items-center gap-3 border-t border-[var(--kant)] px-4 py-3 text-left',
                    'hover:bg-[var(--yta-dampad)] disabled:opacity-50',
                  )}
                >
                  {produkt.imageUrl ? (
                    <img
                      src={`${produkt.imageUrl}?w=80`}
                      alt=""
                      loading="lazy"
                      className="size-12 shrink-0 rounded object-contain"
                    />
                  ) : (
                    <span className="size-12 shrink-0 rounded bg-[var(--yta-dampad)]" />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{produkt.name}</span>
                    <span className="block truncate text-sm text-[var(--text-dampad)]">
                      {produkt.subtitle || produkt.descriptiveSize}
                    </span>
                    {produkt.inStock === false ? (
                      <span className="text-xs text-[var(--color-lingon)]">Slut i butiken</span>
                    ) : null}
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-medium tabular-nums">{formatKr(produkt.price)}</span>
                    {produkt.comparativePrice ? (
                      <span className="block text-xs text-[var(--text-dampad)] tabular-nums">
                        {formatKr(produkt.comparativePrice)}/{produkt.comparativePriceUnit === 'KGM' ? 'kg' : 'l'}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </dialog>
  )
}
