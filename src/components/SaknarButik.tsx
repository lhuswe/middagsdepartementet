import { LinkButton } from './ui/button.tsx'
import { TomtLage } from './ui/feedback.tsx'

/**
 * Visas när ingen butik är vald.
 *
 * Priser, kampanjer och lagerstatus är butiksspecifika, så utan butik finns
 * inget att visa. Tidigare gissade appen på en butik i det här läget, vilket
 * gav priser från fel stad utan att någon märkte det. Att säga ifrån är
 * mindre bekvämt och betydligt ärligare.
 */
export function SaknarButik({ vad }: { vad: string }) {
  return (
    <TomtLage
      rubrik="Ingen butik är vald"
      beskrivning={`${vad} hämtas för en enskild butik, eftersom priser och sortiment skiljer sig åt mellan dem.`}
      action={<LinkButton to="/installningar">Välj butik</LinkButton>}
    />
  )
}
