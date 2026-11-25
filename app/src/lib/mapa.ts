import type { Cliente } from './tipos'

// Localização do cliente para entrega: GPS do celular e links para Google Maps e Waze.
// Os links funcionam sem o app (abrem no navegador) e, se o app estiver instalado,
// o celular oferece abrir nele.

export interface Posicao { latitude: number; longitude: number; precisao: number | null }

export const temLocalizacao = (c?: Cliente | null): c is Cliente & { latitude: number; longitude: number } =>
  c?.latitude != null && c?.longitude != null

const coord = (lat: number, lng: number) => `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`

export const linkGoogleMaps = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${coord(lat, lng)}`

export const linkWaze = (lat: number, lng: number) =>
  `https://waze.com/ul?ll=${coord(lat, lng)}&navigate=yes`

// Rota com várias paradas no Google Maps (até 10 pontos no link; o último é o destino).
export function linkRotaGoogle(pontos: { latitude: number; longitude: number }[]) {
  const p = pontos.slice(0, 10).map((x) => coord(x.latitude, x.longitude))
  if (!p.length) return ''
  const destino = p[p.length - 1]
  const paradas = p.slice(0, -1).join('|')
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${destino}` +
    (paradas ? `&waypoints=${encodeURIComponent(paradas)}` : '')
}

// GPS funciona sem internet. Pede alta precisão e espera até 30 s pelo sinal.
export function pegarPosicao(): Promise<Posicao> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Este celular não informa a localização.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: p.coords.accuracy ? Math.round(p.coords.accuracy) : null }),
      (e) => reject(new Error(
        e.code === e.PERMISSION_DENIED
          ? 'Localização bloqueada. Libere em Configurações do celular > Apps > navegador (ou Maranata) > Permissões > Localização.'
          : e.code === e.TIMEOUT
            ? 'O GPS não respondeu a tempo. Vá para um lugar aberto e tente de novo.'
            : 'Não foi possível pegar a localização. Confira se o GPS (Localização) está ligado.',
      )),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    )
  })
}
