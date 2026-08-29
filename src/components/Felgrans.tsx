import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Felgräns.
 *
 * Utan den blir varje oväntat fel en vit skärm, vilket är det sämsta möjliga
 * felläget: användaren får ingen aning om vad som hänt eller vad som går att
 * göra åt det. Här visas i stället vad som gick fel, rakt formulerat, med en
 * väg vidare.
 *
 * Måste vara en klasskomponent - React har ingen hook-motsvarighet.
 */
interface Props {
  children: ReactNode
}

interface State {
  fel: Error | null
}

export class Felgrans extends Component<Props, State> {
  state: State = { fel: null }

  static getDerivedStateFromError(fel: Error): State {
    return { fel }
  }

  componentDidCatch(fel: Error, info: ErrorInfo) {
    // Loggas till konsolen så att felet går att felsöka. Appen skickar
    // ingenting vidare till någon tredje part.
    console.error('Ohanterat fel i gränssnittet:', fel, info.componentStack)
  }

  render() {
    if (!this.state.fel) return this.props.children

    return (
      <Felsida
        rubrik="Ärendet kunde inte behandlas"
        beskrivning="Ett oväntat fel avbröt sidan. Det är inget du har gjort fel."
        detalj={this.state.fel.message}
      />
    )
  }
}

/**
 * Felsida som fungerar utan resten av appen.
 *
 * Använder inlinestilar med avsikt: den ska kunna visas även när felet är att
 * något i uppstarten inte gick att ladda.
 */
export function Felsida({
  rubrik,
  beskrivning,
  detalj,
  atgard,
}: {
  rubrik: string
  beskrivning: string
  detalj?: string
  atgard?: ReactNode
}) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        background: '#f5f2ed',
        color: '#1f2937',
      }}
    >
      <div style={{ maxWidth: '32rem' }}>
        <p
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#6b7280',
            margin: 0,
          }}
        >
          Departementet för middagsfrågor
        </p>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0.5rem 0 0' }}>{rubrik}</h1>

        <p style={{ margin: '0.75rem 0 0', lineHeight: 1.6 }}>{beskrivning}</p>

        {detalj ? (
          <pre
            style={{
              margin: '1rem 0 0',
              padding: '0.75rem',
              background: '#ffffff',
              border: '1px solid #ddd8d0',
              borderRadius: '0.5rem',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#7f1d1d',
            }}
          >
            {detalj}
          </pre>
        ) : null}

        <div style={{ marginTop: '1.5rem' }}>
          {atgard ?? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: '2.75rem',
                padding: '0 1.25rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: '#1f4e5f',
                color: '#ffffff',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Ladda om sidan
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
