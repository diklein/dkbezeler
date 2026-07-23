/**
 * Frame auto-selection: given a capture's pixel size and the registered frames,
 * choose the frame to bake into.
 *
 *   1. Exact resolution match in devices.json → the frame whose name contains one
 *      of the device's name fragments (first fragment with a match wins).
 *   2. Otherwise: the frame whose screen-hole ASPECT is closest to the capture's,
 *      rejected if it differs by more than 4% (a portrait phone capture must never
 *      silently land in an iPad frame).
 *
 * Every path reports WHY it chose what it chose; the caller prints it.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEVICES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../data/devices.json'), 'utf-8')
).devices

const ASPECT_TOLERANCE = 0.04

export function pickFrame(size, frames) {
  if (!frames.length) {
    throw new Error('no frames registered — run `dkbezeler init` or `dkbezeler measure <frame.png>` first')
  }

  const device = DEVICES.find((d) => d.res === `${size.w}x${size.h}`)
  if (device) {
    for (const fragment of device.match) {
      const frame = frames.find((f) => f.name.toLowerCase().includes(fragment.toLowerCase()))
      if (frame) {
        return { frame, reason: `${size.w}x${size.h} is ${device.name}; matched frame "${frame.name}"` }
      }
    }
  }

  const aspect = size.h / size.w
  let best = null
  for (const f of frames) {
    const holeAspect = f.hole.h / f.hole.w
    const diff = Math.abs(holeAspect - aspect) / aspect
    if (!best || diff < best.diff) best = { frame: f, diff }
  }
  if (best.diff > ASPECT_TOLERANCE) {
    throw new Error(
      `no frame fits a ${size.w}x${size.h} capture (closest is "${best.frame.name}", ` +
      `${(best.diff * 100).toFixed(1)}% off in aspect). Pass --frame to force one.`
    )
  }
  return {
    frame: best.frame,
    reason: `aspect match: "${best.frame.name}" (screen ${best.frame.hole.w}x${best.frame.hole.h}, ${(best.diff * 100).toFixed(1)}% off)`,
  }
}
