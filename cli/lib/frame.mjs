/**
 * Frame geometry. A "frame" is any PNG of a device with a TRANSPARENT screen cutout,
 * ringed completely by solid (alpha 255) bezel. Everything DKBezeler knows about a
 * frame it measures from the file itself, so any bezel art works: Apple's product
 * bezels, Android frames, your own exports.
 *
 * The measurement walk: flood-fill inward from the image border across everything
 * that is not solid bezel. The solid bezel rings the screen completely, so the flood
 * cannot reach the cutout; what it reaches is exactly the EXTERIOR (outside the
 * device, including any soft drop shadow). Transparent pixels that are NOT exterior
 * are the screen hole, and their bounding box is the screen rect.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import sharp from 'sharp'

/** Raw RGBA raster + the exterior map for a frame PNG. */
export async function rasterOf(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const alphaAt = (i) => data[i * 4 + 3]

  const exterior = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w)
  for (let y = 0; y < h; y++) stack.push(y * w, w - 1 + y * w)
  while (stack.length) {
    const i = stack.pop()
    if (exterior[i] || alphaAt(i) === 255) continue // solid bezel is the wall
    exterior[i] = 1
    const x = i % w, y = (i / w) | 0
    if (x > 0) stack.push(i - 1)
    if (x < w - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - w)
    if (y < h - 1) stack.push(i + w)
  }

  return { data, w, h, exterior }
}

/**
 * Measure a frame PNG: image size + screen-hole rect.
 * Throws when no interior transparent region exists (the screen is painted in, or
 * the bezel does not fully ring it) — a frame like that cannot be baked into.
 */
export async function measureFrame(file) {
  const { data, w, h, exterior } = await rasterOf(file)

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let i = 0; i < w * h; i++) {
    // The magick incantation this replaces thresholded alpha at 50%; same here, so a
    // hole edge antialiased against the bezel lands on the same boundary.
    if (exterior[i] || data[i * 4 + 3] >= 128) continue
    const x = i % w, y = (i / w) | 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  if (maxX < 0) {
    throw new Error(
      `${basename(file)}: no transparent screen cutout found. ` +
      'A frame needs a transparent screen area fully ringed by solid bezel.'
    )
  }

  return {
    w,
    h,
    hole: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  }
}

const MANIFEST = 'frames.json'

/** frames.json in a bezels dir: [{ name, file, w, h, hole }] */
export function loadManifest(dir) {
  const p = join(dir, MANIFEST)
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf-8')).frames ?? []
}

export function saveManifest(dir, frames) {
  writeFileSync(join(dir, MANIFEST), JSON.stringify({ frames }, null, 2) + '\n')
}

/** Measure a frame and upsert it into the dir's manifest under a display name. */
export async function registerFrame(dir, file, name) {
  const measured = await measureFrame(join(dir, file))
  const frames = loadManifest(dir).filter((f) => f.file !== file)
  frames.push({ name, file, ...measured })
  frames.sort((a, b) => a.name.localeCompare(b.name))
  saveManifest(dir, frames)
  return measured
}
