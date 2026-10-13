/**
 * The only place in Office Space that talks to Spotify.
 *
 * Everything about this module is arranged around one property from the plan's D3: **the
 * renderer never learns that the network exists.** It asks main for a search result; main makes
 * the request. The renderer's CSP stays `default-src 'self'` exactly as it is, album art arrives
 * as a `data:` URI that `img-src 'self' data:` already allows, and no host is ever added to the
 * policy to buy one picture.
 *
 * ## The four conditions this file has to keep
 *
 * 1. **Off by default.** Nothing here runs until an account is connected. `connected()` is
 *    false, every method short-circuits, and the app makes no request at all.
 * 2. **Every destination declared.** `HOSTS` in `shared/spotify/auth.ts` is what the privacy
 *    panel prints and what {@link request} builds against. One list.
 * 3. **All of it in main.** This file, and nothing in `src/renderer/`.
 * 4. **Nothing about the workspace is ever sent.** The only user data leaving here is a search
 *    string somebody typed and a device id they picked. No path, no prompt, no transcript.
 *
 * There is a fifth that laptop 1 added and it is a good one: **refresh on use, never on a
 * timer.** A refresh loop ticking while nobody is listening is egress at rest, and it makes
 * "zero requests until you connect" quietly false from the day after you connect.
 */

import { API_BASE, HOSTS, isExpired, TOKEN_URL, type Tokens } from '../../shared/spotify/auth.js'
import { NetworkOff } from './gate.js'
import type { Device, Player, Track } from '../../shared/spotify/model.js'

/** How many hops to follow. Spotify uses none; more than a handful is a loop. */
const MAX_REDIRECTS = 3

/**
 * How long a whole request may take, redirects included, before we say we could not find out.
 *
 * The chain rather than any single hop: the signal is created once in `request()` and `post()`
 * and travels through `{ ...init }`, so three hops share this budget. That is deliberate — a
 * per-hop timeout would let `MAX_REDIRECTS` of them take 24 seconds while a controller sat
 * there saying nothing.
 */
const TIMEOUT_MS = 8_000

/**
 * The largest album image we will inline.
 *
 * Data URIs are the right call for the CSP and they are also unbounded heap if nobody says
 * otherwise — laptop 1 flagged exactly this. Spotify offers 640/300/64; 300 is the one a 64px
 * controller can use on a retina screen, and anything past this cap is dropped rather than
 * shown, because a picture is not worth a megabyte of string.
 */
const ARTWORK_MAX_BYTES = 120_000

export interface Store {
  read(): Promise<Tokens | null>
  write(tokens: Tokens | null): Promise<void>
}

/** What the client needs from outside, so tests can supply all of it. */
export interface Deps {
  readonly clientId: string
  readonly store: Store
  /** Injected so tests never reach the network and so there is one place to see that it does. */
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number
}

export class Spotify {
  /**
   * Album art, keyed by the URL it came from.
   *
   * Bounded, and the bound is the point: without one this grows for every track anybody plays
   * for as long as the app is open. Small enough that a long listening session cannot become a
   * memory report, large enough that going back a track does not re-download.
   */
  private readonly artwork = new Map<string, string>()
  private static readonly ARTWORK_CACHE = 32

  constructor(private readonly deps: Deps) {}

  async connected(): Promise<boolean> {
    return (await this.deps.store.read()) !== null
  }

  /** Forget the account. The refresh token is dropped, so the next request cannot be made. */
  async disconnect(): Promise<void> {
    await this.deps.store.write(null)
    this.artwork.clear()
  }

  /**
   * A valid access token, refreshing only if this call needs one.
   *
   * Returns null rather than throwing when there is no account: "not connected" is the ordinary
   * state of this feature and every caller has to handle it anyway.
   */
  private async token(): Promise<string | null> {
    const stored = await this.deps.store.read()
    if (!stored) return null
    if (!isExpired(stored, this.deps.now())) return stored.accessToken

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: this.deps.clientId,
    })

    const response = await this.post(TOKEN_URL, body)
    if (!response.ok) {
      // A refresh token Spotify no longer honours cannot be recovered by retrying, and keeping
      // it means every future call fails the same way. Dropped, so the UI says "not connected"
      // — which is true — rather than "something went wrong" forever.
      if (response.status === 400 || response.status === 401) await this.disconnect()
      return null
    }

    const json = (await response.json()) as { access_token: string; expires_in: number; refresh_token?: string }
    const tokens: Tokens = {
      accessToken: json.access_token,
      // Spotify may or may not rotate it. Keeping the old one when it does not is required;
      // overwriting it with `undefined` when it does not is how an account silently unpairs.
      refreshToken: json.refresh_token ?? stored.refreshToken,
      expiresAt: this.deps.now() + json.expires_in * 1000,
    }
    await this.deps.store.write(tokens)
    return tokens.accessToken
  }

  /**
   * One request to a declared host, with the hops checked too.
   *
   * `request()` below already validated the host and then called `fetch` with no `redirect`
   * option, which is `'follow'` — so it checked the URL this app *asks for* and connected
   * wherever it was sent. `transcribe.ts` had the identical defect and the identical comment
   * about it; the model download turned out to be redirected to a CDN on every single call, so
   * this is not a theoretical shape.
   *
   * `follow: false` for the token exchange. A 307 or 308 resends the body, and that body carries
   * `refresh_token` and `code_verifier` — a long-lived credential and the secret that protects
   * the exchange. Nothing about a token endpoint should redirect, so a redirect there is a
   * reason to stop rather than a hop to validate.
   */
  private async reach(url: string, init: RequestInit, follow: boolean): Promise<Response> {
    const check = (at: string): void => {
      const parsed = new URL(at)
      if (parsed.protocol !== 'https:') {
        throw new Error(`${parsed.protocol}//${parsed.host} is not https, and this app does not send credentials in the clear`)
      }
      if (!HOSTS.includes(parsed.host)) throw new Error(`${parsed.host} is not in the declared egress list`)
    }

    check(url)
    let response = await this.deps.fetch(url, { ...init, redirect: 'manual' })

    for (let hop = 0; response.status >= 300 && response.status < 400; hop++) {
      if (!follow) throw new Error(`${new URL(url).host} redirected a request that must not be redirected`)
      const next = response.headers.get('location')
      if (next === null) throw new Error('redirected with no destination')
      if (hop >= MAX_REDIRECTS) throw new Error(`redirected more than ${MAX_REDIRECTS} times`)
      /*
       * Resolved against the response the `Location` came from, with no fallback.
       *
       * A relative `Location` means "relative to where you just were". This had `|| url` behind
       * it — the *original* request, never reassigned — so the fallback resolved hop 2 against
       * hop 0's address. In production it is dead: `fetch` populates `response.url` under
       * `redirect: 'manual'`. In the tests it was the *only* branch, because a synthetic
       * `Response` has `url === ''` — so every assertion here landed on the path that ships to
       * nobody.
       *
       * Gone rather than corrected. A missing `response.url` is something being wrong about the
       * platform, and `new URL(relative, '')` throwing is a better answer than quietly picking
       * a base. The test stub defines a real `url` now, so the tested path is the shipped one.
       */
      if (!response.url) throw new Error('a redirect arrived with no address to resolve against')
      const target = new URL(next, response.url)
      check(target.href)

      /*
       * The credential does not follow the hop across an origin.
       *
       * `HOSTS` holds three, and a token minted for `api.spotify.com` reaching `i.scdn.co`
       * because a redirect said so is a credential arriving somewhere it was never issued for.
       * Both hosts being declared makes the *connection* fine and says nothing about what the
       * connection is allowed to carry — a distinction the host check on its own cannot draw.
       *
       * Browsers strip `Authorization` on a cross-origin redirect for this reason, and `fetch`
       * with `redirect: 'follow'` would have done it for us. Following by hand means doing it by
       * hand, which is the cost of the loop and easy to forget: the first version of this reused
       * `init` unchanged, and a probe showed `Bearer SECRET` arriving at `i.scdn.co`.
       */
      const sameOrigin = new URL(response.url).origin === target.origin
      const headers = { ...(init.headers as Record<string, string> | undefined) }
      if (!sameOrigin) {
        for (const name of Object.keys(headers)) {
          if (/^(authorization|cookie|proxy-authorization)$/i.test(name)) delete headers[name]
        }
      }

      response = await this.deps.fetch(target, { ...init, headers, redirect: 'manual' })
    }

    return response
  }

  private post(url: string, body: URLSearchParams): Promise<Response> {
    return this.reach(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      false,
    )
  }

  /**
   * One authorised request.
   *
   * The host assertion is not defensive programming for its own sake — the privacy panel prints
   * `HOSTS` as the complete list of what this app can reach, and a request built against
   * anything else would make that printed claim false. Better to fail here than to quietly widen
   * what the panel is promising.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response | null> {
    const access = await this.token()
    if (!access) return null

    const url = path.startsWith('http') ? path : `${API_BASE}${path}`
    return this.reach(
      url,
      {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      true,
    )
  }

  /**
   * What is playing, and on what.
   *
   * Every failure mode here resolves to a state rather than an exception, because the caller is
   * a strip of chrome that has to draw *something* and "we could not find out" is a legitimate
   * thing to draw. The one state it must never invent is `paused` — see `model.ts`.
   */
  async player(): Promise<Player> {
    if (!(await this.connected())) return { state: 'disconnected' }

    try {
      const me = await this.request('/me')
      if (!me) return { state: 'disconnected' }
      if (!me.ok) return { state: 'unknown', why: `Spotify answered ${me.status}` }
      const profile = (await me.json()) as { product?: string }
      // Checked once per poll rather than remembered: a subscription can lapse while the app is
      // open, and a transport that keeps working in the UI after it has stopped working in fact
      // is the failure this whole module is arranged to avoid.
      if (profile.product !== 'premium') return { state: 'needs-premium' }

      const devices = await this.devices()
      const state = await this.request('/me/player')
      if (!state) return { state: 'disconnected' }

      // 204: authorised, understood, and nothing is playing anywhere. Not an error — the
      // documented answer for a silent account, and the reason `no-device` exists.
      if (state.status === 204) return { state: 'no-device', devices }
      if (!state.ok) return { state: 'unknown', why: `Spotify answered ${state.status}` }

      const body = (await state.json()) as SpotifyPlayback
      if (!body?.item || !body.device) return { state: 'no-device', devices }

      return {
        state: body.is_playing ? 'playing' : 'paused',
        track: await this.track(body.item),
        device: toDevice(body.device),
        devices,
        progressMs: body.progress_ms ?? 0,
        since: this.deps.now(),
      }
    } catch (error) {
      // Told not to is not failed to. The switch working correctly must not look like a fault,
      // or the first thing somebody does when they see the error is turn the control back on.
      if (error instanceof NetworkOff) return { state: 'blocked' }
      return { state: 'unknown', why: reason(error) }
    }
  }

  async devices(): Promise<readonly Device[]> {
    const response = await this.request('/me/player/devices')
    if (!response?.ok) return []
    const body = (await response.json()) as { devices?: SpotifyDevice[] }
    return (body.devices ?? []).map(toDevice)
  }

  /** Transport. Returns what went wrong, or null when it worked. */
  async command(what: 'play' | 'pause' | 'next' | 'previous', deviceId?: string): Promise<string | null> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
    const path =
      what === 'next' ? `/me/player/next${query}`
      : what === 'previous' ? `/me/player/previous${query}`
      : `/me/player/${what}${query}`

    try {
      const response = await this.request(path, { method: what === 'play' || what === 'pause' ? 'PUT' : 'POST' })
      if (!response) return 'not connected'
      // 404 from a transport call means "no active device" — Spotify's way of saying nobody was
      // listening. Reported as that rather than as "not found", which would be true and useless.
      if (response.status === 404) return 'nothing is listening — open Spotify on a device first'
      if (response.status === 403) return 'Spotify refused: Premium is required to control playback'
      if (!response.ok && response.status !== 204) return `Spotify answered ${response.status}`
      return null
    } catch (error) {
      return reason(error)
    }
  }

  /** Move playback to a device, which is the answer to `no-device`. */
  async transferTo(deviceId: string, play: boolean): Promise<string | null> {
    try {
      const response = await this.request('/me/player', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_ids: [deviceId], play }),
      })
      if (!response) return 'not connected'
      // The device list is a snapshot, and this is the call somebody makes *because* the last
      // one said nothing was listening — so between the list being drawn and the button being
      // pressed, a phone locks or a speaker sleeps and the target is gone. Its two siblings
      // already translate this status; leaving it raw here meant the one path reached by
      // following the app's own advice answered with the number.
      if (response.status === 404) return 'that device is no longer available — pick another'
      if (!response.ok && response.status !== 204) return `Spotify answered ${response.status}`
      return null
    } catch (error) {
      return reason(error)
    }
  }

  /**
   * Search.
   *
   * The only user data this feature ever sends, and it is a string somebody typed into a box
   * labelled *search*. Tracks only — a controller has no use for the other five result types and
   * asking for them would be asking for more than we need.
   */
  async search(query: string, limit = 8): Promise<readonly Track[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const params = new URLSearchParams({ q: trimmed, type: 'track', limit: String(limit) })
    try {
      const response = await this.request(`/search?${params.toString()}`)
      if (!response?.ok) return []
      const body = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } }
      // Sequential rather than parallel: eight artwork fetches at once against one host is a
      // burst nobody asked for, and a search result list draws fine as it fills.
      const out: Track[] = []
      for (const item of body.tracks?.items ?? []) out.push(await this.track(item))
      return out
    } catch {
      return []
    }
  }

  /** Play a specific track, which is what a search result is for. */
  async playTrack(uri: string, deviceId?: string): Promise<string | null> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
    try {
      const response = await this.request(`/me/player/play${query}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uris: [uri] }),
      })
      if (!response) return 'not connected'
      if (response.status === 404) return 'nothing is listening — open Spotify on a device first'
      if (!response.ok && response.status !== 204) return `Spotify answered ${response.status}`
      return null
    } catch (error) {
      return reason(error)
    }
  }

  private async track(item: SpotifyTrack): Promise<Track> {
    return {
      id: item.id,
      title: item.name,
      artist: (item.artists ?? []).map((a) => a.name).join(', '),
      album: item.album?.name ?? '',
      durationMs: item.duration_ms ?? 0,
      artwork: await this.art(pickImage(item.album?.images ?? [])),
    }
  }

  /**
   * An album image, inlined.
   *
   * Failure is a `null`, never a throw: a missing picture is a controller without a thumbnail,
   * and a controller without a thumbnail still works. Nothing about the music should depend on
   * an image request.
   */
  private async art(url: string | null): Promise<string | null> {
    if (!url) return null
    const cached = this.artwork.get(url)
    if (cached) return cached

    try {
      // Through the same door as everything else. This took a URL straight out of a Spotify API
      // response and fetched it with no host check at all — the panel happened to be right
      // because `i.scdn.co` is declared, which is luck rather than the rule this module states
      // for `request()` twenty lines up. A `throw` here is caught below and becomes a missing
      // thumbnail, which is what this method already does with every other failure.
      const response = await this.reach(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }, true)
      if (!response.ok) return null
      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.byteLength > ARTWORK_MAX_BYTES) return null

      let binary = ''
      for (const byte of buffer) binary += String.fromCharCode(byte)
      const type = response.headers.get('content-type') ?? 'image/jpeg'
      const uri = `data:${type};base64,${btoa(binary)}`

      // Oldest out. A Map iterates in insertion order, so the first key is the least recently
      // added — good enough for a cache whose whole job is "do not re-fetch the last few".
      if (this.artwork.size >= Spotify.ARTWORK_CACHE) {
        const oldest = this.artwork.keys().next().value
        if (oldest) this.artwork.delete(oldest)
      }
      this.artwork.set(url, uri)
      return uri
    } catch {
      return null
    }
  }
}

/** 300px if it exists: the size a 64px control can use on a retina screen without waste. */
function pickImage(images: readonly SpotifyImage[]): string | null {
  if (!images.length) return null
  const sorted = [...images].sort((a, b) => Math.abs((a.width ?? 0) - 300) - Math.abs((b.width ?? 0) - 300))
  return sorted[0]?.url ?? null
}

function toDevice(device: SpotifyDevice): Device {
  return {
    id: device.id ?? '',
    name: device.name ?? 'a device',
    kind: device.type ?? 'Unknown',
    active: device.is_active ?? false,
  }
}

/** A timeout is the common failure and deserves a sentence rather than `AbortError`. */
function reason(error: unknown): string {
  if (error instanceof NetworkOff) return error.message
  if (error instanceof Error && error.name === 'TimeoutError') return 'it did not answer in time'
  return error instanceof Error ? error.message : String(error)
}

// The slices of Spotify's payloads this file reads. Declared rather than `any`, so a shape
// change is a compile error somewhere rather than `undefined` on screen.
interface SpotifyImage { url: string; width?: number }
interface SpotifyDevice { id?: string; name?: string; type?: string; is_active?: boolean }
interface SpotifyTrack {
  id: string
  name: string
  duration_ms?: number
  artists?: { name: string }[]
  album?: { name?: string; images?: SpotifyImage[] }
}
interface SpotifyPlayback {
  is_playing?: boolean
  progress_ms?: number
  item?: SpotifyTrack
  device?: SpotifyDevice
}
