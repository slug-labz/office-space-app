/**
 * The controller.
 *
 * Clicking the sofa is not very intuitive, so there is UI that actually renders the Spotify
 * song that is playing, with next and changing songs — and search, which matters most.
 *
 * The sofa still works and is now a shortcut rather than the only door — a shortcut is allowed
 * to be obscure, it is just not allowed to be the whole feature.
 *
 * **This module never touches the network.** Every call goes through the bridge to main, which
 * is the only place in the app that speaks to Spotify. The renderer's CSP is untouched, and the
 * album art arrives as a `data:` URI that `img-src 'self' data:` already allows — so a picture
 * costs a few kilobytes rather than a widened security policy.
 *
 * The states are `shared/spotify/model.ts` and the drawing here follows them exactly, including
 * the two that a naive controller would collapse: **nothing is listening** is not **paused**,
 * and **we could not find out** is not **signed out**.
 */

import { advice, canControl, clock, progressAt, type Device, type Player, type Track } from '../../shared/spotify/model.js'
import type { MusicCommand, MusicConnection, MusicSetup } from '../../shared/ipc.js'
import { musicChrome, type MusicChrome } from '../../shared/music-view.js'

export interface MusicBridge {
  player(): Promise<Player>
  connect(): Promise<MusicConnection>
  disconnect(): Promise<void>
  command(what: MusicCommand, deviceId?: string): Promise<string | null>
  transfer(deviceId: string, play: boolean): Promise<string | null>
  search(query: string): Promise<readonly Track[]>
  playTrack(uri: string, deviceId?: string): Promise<string | null>
  setup(): Promise<MusicSetup>
  setClientId(clientId: string): Promise<void>
  setNetwork(allowed: boolean): Promise<void>
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface Music {
  /** Re-read the player and redraw. Safe to call when disconnected — it makes no request. */
  refresh(): Promise<void>
  /** What the strip's one-line summary should say. */
  summary(): string
  /** True while something is really coming out of a speaker. The room reads this. */
  isPlaying(): boolean
}

/** What the panel needs from the app around it, beyond Spotify. */
export interface MusicHandlers {
  /** The player changed. The room reads this to decide whether the carpet is warm. */
  readonly changed: () => void
  /** The person is done with this panel. Owned by the app, because the app owns the pill. */
  readonly close: () => void
}

export function mountMusic(host: HTMLElement, bridge: MusicBridge, on: MusicHandlers): Music {
  let player: Player = { state: 'disconnected' }
  let setup: MusicSetup | null = null
  /**
   * Collapsed by default, and it matters which way round that is.
   *
   * The player was missing a minimize button and a close button, and there was no way to pause
   * music. The panel had one state and it was 277px tall — it took that from the floor whether
   * you were picking a device or just wanted to see what was playing. A device picker and a
   * search box are things you use once; what is playing is something you glance at.
   *
   * Collapsing never hides the transport. That is the whole point: pause is one click from
   * anywhere the strip is visible, which is the actual fix for "there is no way to pause music".
   */
  let collapsed = true
  let problem: string | null = null
  let results: readonly Track[] = []
  let searching = false

  /** Run a transport call and show whatever went wrong, verbatim. */
  const act = async (run: () => Promise<string | null>) => {
    problem = await run()
    await refresh()
  }

  /**
   * Re-read the player and redraw.
   *
   * The two awaits are why this says so first. `player()` can take up to the client's whole
   * timeout on a machine whose network is slow or whose Spotify is asleep, and every panel in
   * this app that fetches announces it — E4's *"panels pop in with no indication they are
   * fetching"*, which was fixed everywhere except the panel that had not been written yet.
   *
   * Only when there is something to wait *for*. Disconnected answers without a request, so
   * saying "checking" there would be a spinner for work nobody is doing, which is its own kind
   * of lie.
   */
  const refresh = async () => {
    if (player.state !== 'disconnected') pending()
    player = await bridge.player()
    if (!setup) setup = await bridge.setup()
    draw()
    on.changed()
  }

  /** One line, in the shape every other panel uses. */
  const pending = () => {
    host.replaceChildren()
    host.appendChild(el('p', 'loading', 'Asking Spotify what is playing…'))
  }

  /**
   * The two controls the panel was missing, and one label.
   *
   * Both are icon buttons at 28 x 28 rather than text, because they are the two controls in this
   * app whose meaning is genuinely universal — and both were absent, so the only way out of a
   * 277px panel was to find the pill in the floor footer that opened it.
   */
  const header = (chrome: MusicChrome): HTMLElement => {
    const bar = el('div', 'music__head')
    bar.appendChild(el('p', 'music__heading', 'Music'))

    if (chrome.canFold) {
      const fold = el('button', 'music__icon', collapsed ? '⌄' : '⌃') as HTMLButtonElement
      fold.type = 'button'
      fold.setAttribute('aria-expanded', String(!collapsed))
      fold.setAttribute('aria-label', collapsed ? 'Show devices and search' : 'Collapse to what is playing')
      fold.title = fold.getAttribute('aria-label') ?? ''
      fold.addEventListener('click', () => {
        collapsed = !collapsed
        draw()
      })
      bar.appendChild(fold)
    }

    const shut = el('button', 'music__icon', '×') as HTMLButtonElement
    shut.type = 'button'
    shut.setAttribute('aria-label', 'Close the music')
    shut.title = 'Close the music'
    // The app owns the pill's pressed state, so the app owns closing. The panel only asks.
    shut.addEventListener('click', () => on.close())
    bar.appendChild(shut)
    return bar
  }

  const draw = () => {
    host.replaceChildren()
    // The fold is a layout change, not just a subtraction: collapsed, what is playing and the
    // transport share one row. Stacking them was most of the height the fold was meant to save.
    const chrome = musicChrome(player.state, collapsed)
    host.classList.toggle('music--tight', collapsed && chrome.canFold)
    host.appendChild(header(chrome))
    host.appendChild(
      player.state === 'disconnected' ? signIn() : el('div', 'music__body', undefined),
    )
    if (chrome.showsTransport) {
      const body = host.lastElementChild as HTMLElement
      body.appendChild(nowPlaying())
      body.appendChild(transport())
      const note = advice(player)
      if (note) body.appendChild(el('p', 'music__advice', note))
      if (chrome.showsDevices) body.appendChild(devicePicker())
      if (chrome.showsSearch) body.appendChild(searchBox())
    }
    // The switch, on every state including `disconnected`, and on both sides of the fold.
    //
    // It is a control over what this app may do, not a setting belonging to a feature you have
    // already turned on — somebody who wants to be sure it reaches nowhere must be able to say
    // so *before* connecting anything, and find it in the same place afterwards. Collapsing is a
    // request for less furniture, not a reason to hide the one control that is about consent.
    host.appendChild(networkSwitch())
    if (problem) host.appendChild(el('p', 'music__problem', problem))
  }

  const networkSwitch = (): HTMLElement => {
    const row = el('div', 'music__switch')
    // Three states, not two, and **four things to draw**. `unreadable` means the saved setting is
    // torn or locked — the main process holds the network off in that case, and the one thing this
    // panel must not do is render it as either of the other two. A person who switched this off
    // and came back to a silent `on` is the failure the third state exists to make impossible.
    //
    // `null` is the fourth: `setup` is not back from main yet. The first `draw()` is synchronous
    // and runs before `refresh()` resolves, so this is not an edge case — it is every startup, for
    // two round trips, and for the whole run if main never answers, because the read is cached.
    // `?? 'on'` spelled that window as the permissive state and undid the fix above in one
    // character. Not-read-yet is the same shape as `unreadable` one level up: absent is not empty,
    // and a reading nobody has taken is not a reading of `on`.
    const state = setup?.networkAllowed ?? null
    const on = state === 'on'

    const label =
      state === 'on'
        ? 'network on'
        : state === 'off'
          ? 'network off'
          : state === 'unreadable'
            ? 'network setting unreadable'
            : 'network setting not read yet'
    const toggle = el('button', 'btn btn--ghost btn--sm', label) as HTMLButtonElement
    toggle.type = 'button'
    // `aria-pressed` is a boolean attribute and cannot carry three states, so the unreadable case
    // is announced in the accessible name instead of being rounded to one of the two. Not-read-yet
    // is left off the attribute altogether rather than written as `false`: `false` is announced as
    // "not pressed", which is the `off` reading with a nicer excuse.
    if (state !== null) toggle.setAttribute('aria-pressed', String(on))
    toggle.title =
      state === 'on'
        ? 'Office Space may make its own network requests. Click to stop it.'
        : state === 'off'
          ? 'Office Space is making no network requests of its own. Click to allow them.'
          : state === 'unreadable'
            ? 'The saved setting could not be read, so no request is being made. Click to set it again.'
            : 'The saved setting has not been read yet, so this does not say which way it is set. Click to ask again.'
    toggle.addEventListener('click', async () => {
      // Nothing to flip before the setting has been read: `!on` would be a guess, and the guess
      // writes over whatever is saved — from a guess of `on` it writes `off`, which is the same
      // bug pointing the other way. So the press asks again instead. `refresh()` re-reads the
      // setup precisely because it is still null, and the label answers when the read lands.
      if (state === null) {
        await refresh()
        return
      }
      // From `unreadable`, the click writes `on` — it is the only state the person can be asking
      // for, since off is already what is happening. Either way the write heals the file.
      await bridge.setNetwork(!on)
      setup = await bridge.setup()
      problem = null
      await refresh()
    })
    row.appendChild(toggle)
    row.appendChild(
      el(
        'span',
        'music__label',
        state === 'on'
          ? 'Applies to Spotify only — claude is a separate process.'
          : state === 'off'
            ? 'No request can be made while this is off.'
            : state === 'unreadable'
              ? 'Held off until you set it again. No request can be made meanwhile.'
              : 'Asking for the saved setting. Nothing here says which way it is set.',
      ),
    )
    return row
  }

  /**
   * The setup panel.
   *
   * Long, and it has to be: there is no client id in this repository and there is no way to make
   * that not require an explanation. Under PKCE the id is not a secret — shipping one would be
   * *safe*. It would not be *ours to give*: every install would share one app's rate limits and
   * one redirect whitelist. So the panel says what to do, in order, with the redirect URI
   * printed exactly as it must be pasted.
   */
  const signIn = (): HTMLElement => {
    const box = el('div', 'music__setup')
    box.appendChild(el('p', 'music__title', 'Spotify'))
    box.appendChild(
      el(
        'p',
        'music__advice',
        'Office Space drives your own Spotify app — it does not play audio itself, so playback needs Spotify Premium. Until you connect, it makes no requests to Spotify at all.',
      ),
    )

    const steps = el('ol', 'music__steps')
    for (const step of [
      'Create an app at developer.spotify.com/dashboard — two fields, no cost.',
      `Add this exact redirect URI: ${setup?.redirectUri ?? ''}`,
      'Paste the Client ID below.',
    ]) {
      steps.appendChild(el('li', undefined, step))
    }
    box.appendChild(steps)

    const row = el('div', 'music__row')
    const input = el('input', 'music__input') as HTMLInputElement
    input.type = 'text'
    input.placeholder = 'Spotify Client ID'
    input.value = setup?.clientId ?? ''
    input.setAttribute('aria-label', 'Spotify Client ID')
    row.appendChild(input)

    const go = el('button', 'btn btn--primary btn--sm', 'Connect') as HTMLButtonElement
    go.type = 'button'
    go.addEventListener('click', async () => {
      go.disabled = true
      go.textContent = 'Waiting for your browser…'
      await bridge.setClientId(input.value.trim())
      const result = await bridge.connect()
      problem = result.problem
      setup = await bridge.setup()
      await refresh()
    })
    row.appendChild(go)
    box.appendChild(row)

    if (setup?.scopes.length) {
      box.appendChild(
        el(
          'p',
          'music__scopes',
          `It asks for: ${setup.scopes.join(', ')}. Not your playlists, library, email or follows.`,
        ),
      )
    }
    return box
  }

  const nowPlaying = (): HTMLElement => {
    const row = el('div', 'music__now')
    if (player.state !== 'playing' && player.state !== 'paused') {
      // Four states reach here and three of them are different things. `no-device` is the only one
      // where nothing really is playing: Spotify is open nowhere, so the silence is a fact about
      // the world. `blocked` is *we did not ask* and `unknown` is *we asked and could not find
      // out* — `model.ts` keeps them apart on purpose, and drawing either as "Nothing playing"
      // asserts a fact about a track this app never heard anything about, two lines above an
      // `advice()` line that says the opposite. The last arm holds `needs-premium` and
      // `disconnected`, which are about the account and claim nothing about playback either way.
      const said =
        player.state === 'blocked'
          ? 'Not asked'
          : player.state === 'unknown'
            ? 'Could not find out'
            : player.state === 'no-device'
              ? 'Nothing playing'
              : 'Spotify'
      row.appendChild(el('span', 'music__title', said))
      return row
    }

    if (player.track.artwork) {
      const art = el('img', 'music__art') as HTMLImageElement
      art.src = player.track.artwork
      art.alt = ''
      row.appendChild(art)
    }

    const lines = el('div', 'music__lines')
    lines.appendChild(el('span', 'music__title', player.track.title))
    lines.appendChild(el('span', 'music__artist', player.track.artist))
    row.appendChild(lines)

    const at = progressAt(player, Date.now())
    row.appendChild(el('span', 'music__clock', `${clock(at)} / ${clock(player.track.durationMs)}`))
    return row
  }

  const transport = (): HTMLElement => {
    const row = el('div', 'music__transport')
    const on = canControl(player)
    const playing = player.state === 'playing'
    const device = player.state === 'playing' || player.state === 'paused' ? player.device.id : undefined

    for (const [label, what, symbol] of [
      ['Previous', 'previous', '⏮'],
      [playing ? 'Pause' : 'Play', playing ? 'pause' : 'play', playing ? '⏸' : '▶'],
      ['Next', 'next', '⏭'],
    ] as const) {
      const button = el('button', 'music__key', symbol) as HTMLButtonElement
      button.type = 'button'
      button.setAttribute('aria-label', label)
      // Disabled rather than hidden, and never *looks* enabled when it is not: a transport that
      // silently does nothing is the exact failure `no-device` exists to prevent.
      button.disabled = !on
      button.addEventListener('click', () => void act(() => bridge.command(what as MusicCommand, device)))
      row.appendChild(button)
    }
    return row
  }

  const devicePicker = (): HTMLElement => {
    const devices: readonly Device[] =
      player.state === 'no-device' || player.state === 'playing' || player.state === 'paused'
        ? player.devices
        : []
    const box = el('div', 'music__devices')
    if (!devices.length) return box

    box.appendChild(el('span', 'music__label', 'Playing on'))
    for (const device of devices) {
      const button = el('button', 'btn btn--ghost btn--sm', `${device.name} · ${device.kind}`) as HTMLButtonElement
      button.type = 'button'
      button.setAttribute('aria-pressed', String(device.active))
      button.addEventListener('click', () => void act(() => bridge.transfer(device.id, true)))
      box.appendChild(button)
    }
    return box
  }

  const searchBox = (): HTMLElement => {
    const box = el('div', 'music__search')
    const row = el('div', 'music__row')

    const input = el('input', 'music__input') as HTMLInputElement
    input.type = 'search'
    input.placeholder = 'Search Spotify…'
    input.setAttribute('aria-label', 'Search Spotify')

    const run = async () => {
      const query = input.value.trim()
      if (!query || searching) return
      searching = true
      results = await bridge.search(query)
      searching = false
      draw()
      // Redrawing replaces the input, so focus and text are put back — otherwise every search
      // ends with the cursor somewhere else and the query gone.
      const again = host.querySelector<HTMLInputElement>('.music__search .music__input')
      if (again) {
        again.value = query
        again.focus()
      }
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void run()
    })
    row.appendChild(input)
    box.appendChild(row)

    if (results.length) {
      const list = el('div', 'music__results')
      for (const track of results) {
        const hit = el('button', 'music__hit') as HTMLButtonElement
        hit.type = 'button'
        if (track.artwork) {
          const art = el('img', 'music__art music__art--sm') as HTMLImageElement
          art.src = track.artwork
          art.alt = ''
          hit.appendChild(art)
        }
        const lines = el('div', 'music__lines')
        lines.appendChild(el('span', 'music__title', track.title))
        lines.appendChild(el('span', 'music__artist', track.artist))
        hit.appendChild(lines)
        hit.appendChild(el('span', 'music__clock', clock(track.durationMs)))
        const device = player.state === 'playing' || player.state === 'paused' ? player.device.id : undefined
        hit.addEventListener('click', () => void act(() => bridge.playTrack(`spotify:track:${track.id}`, device)))
        list.appendChild(hit)
      }
      box.appendChild(list)
    }
    return box
  }

  // Draw once synchronously so the panel is never blank, then read the setup.
  //
  // Without the second call the first paint shows *"Add this exact redirect URI:"* followed by
  // nothing, because `setup` is still null — a step somebody would follow and get wrong. Caught
  // by opening the panel rather than by a type.
  //
  // This makes no network request: `musicPlayer()` answers `disconnected` in main without
  // asking anybody, which is the whole point of that state existing.
  draw()
  void refresh()

  return {
    refresh,
    isPlaying: () => player.state === 'playing',
    summary: () =>
      player.state === 'playing' || player.state === 'paused'
        ? `${player.state === 'playing' ? '♪' : '⏸'} ${player.track.title} — ${player.track.artist}`
        : player.state === 'disconnected'
          ? 'music · not connected'
          : 'music',
  }
}
