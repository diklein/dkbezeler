#!/usr/bin/env node
/**
 * DKBezeler — bake screenshots and screen recordings into device bezel frames.
 *
 *   dkbezeler init [device ...] [--all] [--dir bezels]     fetch Apple bezels + measure them
 *   dkbezeler measure <frame.png> [--name "…"] [--dir]     register your own frame art
 *   dkbezeler frames [--dir bezels]                        list registered frames
 *   dkbezeler check <input>                                exit 0 if it looks like a device capture
 *   dkbezeler <input …> [options]                          bake
 *
 * Bake options:
 *   --dir <bezels>     frames dir (default ./bezels)
 *   --frame <name|png> force a frame: a registered frame's name (substring) or a PNG path
 *   --out <dir>        output dir (default alongside the input)
 *   --name <base>      output base name, used verbatim (default: slugified input name)
 *   --bg-light <hex>   video corner colour, light master (default #ffffff)
 *   --bg-dark <hex>    video corner colour, dark master (default #0f1317 — pre-compensated
 *                      one step brighter than #0e1215 for the YUV420 round trip)
 *
 * Stills  → <base>-framed.png   (transparent outside the device)
 * Videos  → <base>-light.mp4 / <base>-dark.mp4 + matching .jpg posters
 *           (H.264 has no alpha, so each master gets page-matched corners)
 *
 * Requires ffmpeg on PATH for video input only. Stills are pure sharp.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, extname, resolve } from 'node:path'
import sharp from 'sharp'
import { measureFrame, loadManifest, registerFrame } from './lib/frame.mjs'
import { pickFrame } from './lib/pick.mjs'
import { bakeStill, bakeVideo, DEFAULT_THEME_BG } from './lib/bake.mjs'
import { init, SOURCES } from './lib/init.mjs'

const IMAGE_EXT = /\.(png|jpe?g|webp|tiff?)$/i
const VIDEO_EXT = /\.(mov|mp4|m4v|webm)$/i

// Loose portrait-capture band for `check`: phone screens are ~2.16 tall, regular
// photos (3:4 ≈ 1.33) never fall in it. Tablets sit near 1.33 too, so check is a
// phone heuristic; bake itself matches any registered frame by resolution/aspect.
const ASPECT_MIN = 1.95
const ASPECT_MAX = 2.35
const MIN_WIDTH = 700

async function mediaSize(file) {
  if (IMAGE_EXT.test(file)) {
    const meta = await sharp(file).metadata()
    // EXIF orientations 5-8 are rotated 90°: the raster is landscape, the capture portrait.
    const swap = (meta.orientation ?? 1) >= 5
    return { w: swap ? meta.height : meta.width, h: swap ? meta.width : meta.height, kind: 'image' }
  }
  if (VIDEO_EXT.test(file)) {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
    ], { encoding: 'utf-8' }).trim()
    const [w, h] = out.split(',').map(Number)
    return { w, h, kind: 'video' }
  }
  return null
}

function fail(msg, code = 2) {
  console.error(`dkbezeler: ${msg}`)
  process.exit(code)
}

function flag(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

function positionals(args) {
  const takesValue = new Set(['--dir', '--frame', '--out', '--name', '--bg-light', '--bg-dark'])
  return args.filter((a, i) => !a.startsWith('--') && !takesValue.has(args[i - 1]))
}

const args = process.argv.slice(2)
const command = args[0]
const bezelsDir = resolve(flag(args, '--dir') ?? 'bezels')

if (!command) {
  console.error('usage: dkbezeler <init|measure|frames|check|input…> — see --help')
  process.exit(2)
}

if (command === '--help' || command === '-h') {
  console.log(`dkbezeler init [device ...] [--all] [--dir bezels]
dkbezeler measure <frame.png> [--name "…"] [--dir bezels]
dkbezeler frames [--dir bezels]
dkbezeler check <input>
dkbezeler <input …> [--frame name|png] [--out dir] [--name base] [--bg-light hex] [--bg-dark hex]

devices for init: ${SOURCES.map((s) => s.key).join(', ')}`)
  process.exit(0)
}

if (command === 'init') {
  const keys = args.includes('--all') ? SOURCES.map((s) => s.key) : positionals(args.slice(1))
  await init(bezelsDir, keys).catch((e) => fail(e.message))
  process.exit(0)
}

if (command === 'measure') {
  const files = positionals(args.slice(1))
  if (!files.length) fail('measure needs at least one frame PNG')
  mkdirSync(bezelsDir, { recursive: true })
  for (const f of files) {
    if (!existsSync(f)) fail(`no such file: ${f}`)
    // Copy into the bezels dir if it lives elsewhere, so frames.json paths stay local.
    const name = flag(args, '--name') ?? basename(f, extname(f))
    const local = join(bezelsDir, basename(f))
    if (resolve(f) !== resolve(local)) {
      execFileSync('cp', [f, local])
    }
    const { w, h, hole } = await registerFrame(bezelsDir, basename(f), name).catch((e) => fail(e.message))
    console.log(`${name}: ${w}x${h}, screen ${hole.w}x${hole.h} at +${hole.x}+${hole.y}`)
  }
  process.exit(0)
}

if (command === 'frames') {
  const frames = loadManifest(bezelsDir)
  if (!frames.length) {
    console.log(`no frames registered in ${bezelsDir} — run \`dkbezeler init\` or \`dkbezeler measure\``)
    process.exit(0)
  }
  for (const f of frames) {
    console.log(`${f.name}  (${f.file}, ${f.w}x${f.h}, screen ${f.hole.w}x${f.hole.h})`)
  }
  process.exit(0)
}

if (command === 'check') {
  const input = positionals(args.slice(1))[0]
  if (!input || !existsSync(input)) process.exit(1)
  const size = await mediaSize(input).catch(() => null)
  if (!size) process.exit(1)
  const aspect = size.h / size.w
  if (size.h > size.w && size.w >= MIN_WIDTH && aspect >= ASPECT_MIN && aspect <= ASPECT_MAX) {
    console.log(`device-${size.kind}`)
    process.exit(0)
  }
  process.exit(1)
}

// ── bake ─────────────────────────────────────────────────────────────────────
const inputs = positionals(args)
if (!inputs.length) fail('nothing to bake')

const frames = loadManifest(bezelsDir)
const frameArg = flag(args, '--frame')
const themeBg = {
  light: flag(args, '--bg-light') ?? DEFAULT_THEME_BG.light,
  dark: flag(args, '--bg-dark') ?? DEFAULT_THEME_BG.dark,
}

for (const input of inputs) {
  if (!existsSync(input)) fail(`no such file: ${input}`)
  const size = await mediaSize(input)
  if (!size) fail(`unsupported file type: ${input}`)

  let frame, reason
  if (frameArg && /\.png$/i.test(frameArg)) {
    if (!existsSync(frameArg)) fail(`no such frame: ${frameArg}`)
    const measured = await measureFrame(frameArg).catch((e) => fail(e.message))
    frame = { name: basename(frameArg, '.png'), file: resolve(frameArg), ...measured }
    reason = 'forced by --frame'
  } else if (frameArg) {
    const found = frames.find((f) => f.name.toLowerCase().includes(frameArg.toLowerCase()))
    if (!found) fail(`no registered frame matches "${frameArg}" — see \`dkbezeler frames\``)
    frame = found
    reason = 'forced by --frame'
  } else {
    try {
      ;({ frame, reason } = pickFrame(size, frames))
    } catch (e) {
      fail(e.message, 1)
    }
  }
  if (!frame.file.startsWith('/')) frame = { ...frame, file: join(bezelsDir, frame.file) }
  if (!existsSync(frame.file)) fail(`frame asset missing: ${frame.file}`)

  const outDir = flag(args, '--out') ?? dirname(input)
  mkdirSync(outDir, { recursive: true })
  // An explicit --name is used VERBATIM — slugifying it would strip meaningful
  // characters and land re-bakes beside the originals instead of replacing them.
  const base = flag(args, '--name') ?? basename(input, extname(input))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const outBase = join(outDir, base)

  console.log(`${basename(input)} (${size.w}x${size.h}) → ${frame.name} — ${reason}`)
  const outputs = size.kind === 'image'
    ? await bakeStill(input, frame, outBase)
    : await bakeVideo(input, frame, outBase, themeBg)
  for (const o of outputs) console.log(`  ${o}`)
  if (size.kind === 'video') {
    console.log(`  light/dark masters: render both, swap with CSS (see DKBezelVideo)`)
  }
}
