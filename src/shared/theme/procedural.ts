/**
 * The built-in theme: characters drawn in code.
 *
 * This is the default and the guarantee. It needs no files, no network, no purchase and no
 * licence, it renders an unlimited cast, and it is the only theme whose art can ship inside
 * the repository. Every other theme is a user's own licensed copy, living on their machine.
 */

import { FRAME_H, FRAME_W, PAINT_DIRECTIONS, paintFrame } from '../character/painter.js'
import { recipeFor } from '../character/recipe.js'
import type { CharacterFrames, CharacterTheme, Pixels } from './theme.js'

export const PROCEDURAL_THEME_ID = 'procedural'

export const proceduralTheme: CharacterTheme = {
  id: PROCEDURAL_THEME_ID,
  name: 'Drawn in code',
  credit: null,
  redistributable: true,

  framesFor(agentName: string, description = ''): CharacterFrames {
    const recipe = recipeFor(agentName, description)
    const frames = {} as Record<(typeof PAINT_DIRECTIONS)[number], Pixels[]>

    for (const direction of PAINT_DIRECTIONS) {
      frames[direction] = [0, 1, 2].map((step) => paintFrame(recipe, direction, step))
    }

    return { width: FRAME_W, height: FRAME_H, frames }
  },
}
