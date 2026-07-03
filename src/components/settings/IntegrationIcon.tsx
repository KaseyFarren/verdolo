const BRAND: Record<string, string> = {
  anthropic: '#CC785C',
  gmail: '#EA4335',
  gcal: '#1A73E8',
  slack: '#4A154B',
  zoom: '#2D8CFF',
  teams: '#6264A7',
  notion: '#191919',
  hubspot: '#FF7A59',
  zapier: '#FF4A00',
  calendly: '#006BFF',
}

function Glyph({ name }: { name: string }) {
  const stroke = 'white'
  switch (name) {
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 3v18M12 3l6 18M12 3L6 21M4 15h16" />
        </svg>
      )
    case 'gmail':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M3.5 6l8.5 7 8.5-7" />
        </svg>
      )
    case 'gcal':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="1.5" />
          <path d="M3 9.5h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'calendly':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="1.5" />
          <path d="M3 9.5h18M8 3v4M16 3v4" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      )
    case 'slack':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 3v6M9 9H4M15 21v-6M15 15h5M9 15H4M9 15v6M15 3v6M15 9h5" />
        </svg>
      )
    case 'zoom':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="3" y="7" width="12" height="10" rx="1.5" />
          <path d="M15 10.5l6-3v9l-6-3z" />
        </svg>
      )
    case 'teams':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="7" r="2" />
          <path d="M15 12.5c.6-.3 1.3-.5 2-.5 2.2 0 4 1.8 4 4v1" />
        </svg>
      )
    case 'notion':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <path d="M8 8v8M8 8l8 8M16 8v8" />
        </svg>
      )
    case 'hubspot':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.6">
          <circle cx="12" cy="12" r="2.5" />
          <circle cx="12" cy="4.5" r="1.8" />
          <circle cx="18.5" cy="15" r="1.8" />
          <circle cx="5.5" cy="15" r="1.8" />
          <path d="M12 6.3V9.7M13.8 13.4l3.2 1.9M10.2 13.4l-3.2 1.9" />
        </svg>
      )
    case 'zapier':
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill={stroke} stroke="none">
          <path d="M13 2L4.5 14h5.5l-2 8L19.5 10H14l2-8z" />
        </svg>
      )
    default:
      return null
  }
}

export default function IntegrationIcon({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: BRAND[name] ?? '#5d6b5c' }}
    >
      <Glyph name={name} />
    </div>
  )
}
