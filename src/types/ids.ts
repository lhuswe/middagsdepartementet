/**
 * Märkta id-typer.
 *
 * Hushålls-id och användar-id är båda uuid i en `string`, och kompilatorn kan
 * inte skilja dem åt. Det blev dyrt: när ägarskapet flyttade från person till
 * hushåll missades fem anropsställen som fortsatte skicka `user.id` till
 * funktioner som numera vill ha hushållets id.
 *
 * Följderna syntes inte. Läsningarna gav tomma resultat i stället för fel -
 * historiken var alltid tom, skafferiet likaså - och skrivningarna föll på en
 * RLS-policy som ingen visade. Allt kompilerade.
 *
 * Med ett märke på typen blir samma misstag ett kompileringsfel. Märket finns
 * bara i typsystemet; vid körning är det en vanlig sträng.
 */

declare const marke: unique symbol

/** Id för ett hushåll. Kommer från `useHushall()`, aldrig från `user.id`. */
export type HouseholdId = string & { readonly [marke]: 'household' }

/**
 * Märker en sträng som hushålls-id.
 *
 * Ska bara användas där id:t bevisligen kommer från hushållstabellen: i
 * `useHushall`, i `hushall.ts`, och när ett hushåll just skapats. Överallt
 * annars ska typen bäras vidare i stället för att sättas på nytt.
 */
export function somHouseholdId(id: string): HouseholdId {
  return id as HouseholdId
}
