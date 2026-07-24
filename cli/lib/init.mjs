/**
 * `dkbezeler init` — fetch Apple's product bezels onto YOUR machine.
 *
 * Apple publishes bezel art as public .dmg downloads on their CDN (PNG + Photoshop
 * inside, no sign-in). DKBezeler never redistributes that art; init automates the
 * download you would otherwise do by hand at developer.apple.com/design/resources/,
 * extracts the PNGs into your bezels dir, and measures each one into frames.json.
 * Apple's terms for the bezels (marketing use of your own product shots) are yours
 * to follow: https://developer.apple.com/app-store/marketing/guidelines/
 *
 * .dmg extraction uses hdiutil, so init's download step is macOS-only. On other
 * platforms: download the .dmg from Apple, extract the PNGs with 7-Zip, then run
 * `dkbezeler measure <frame.png>` — everything past init is portable.
 */

import { execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { registerFrame } from './frame.mjs'

const CDN = 'https://devimages-cdn.apple.com/design/resources/download'

/** The catalog init knows how to fetch. Names mirror Apple's download list. */
export const SOURCES = [
  { key: 'iphone-17', dmg: 'Bezel-iPhone-17.dmg', label: 'iPhone 17 family' },
  { key: 'iphone-16', dmg: 'Bezel-iPhone-16.dmg', label: 'iPhone 16 family' },
  { key: 'ipad-pro', dmg: 'Bezel-iPad-Pro-(M5).dmg', label: 'iPad Pro (M5)' },
  { key: 'ipad-air', dmg: 'Bezel-iPad-Air-(M4).dmg', label: 'iPad Air (M4)' },
  { key: 'ipad-mini', dmg: 'Bezel-iPad-mini-(A17-Pro).dmg', label: 'iPad mini (A17 Pro)' },
  { key: 'ipad', dmg: 'Bezel-iPad-(A16).dmg', label: 'iPad (A16)' },
  { key: 'watch-series-11', dmg: 'Bezel-Apple-Watch-Series-11-2025.dmg', label: 'Apple Watch Series 11' },
  { key: 'watch-ultra-3', dmg: 'Bezel-Apple-Watch-Ultra-3-2025.dmg', label: 'Apple Watch Ultra 3' },
]

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

function collectPngs(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) collectPngs(p, found)
    else if (/\.png$/i.test(entry.name) && !entry.name.startsWith('.')) found.push(p)
  }
  return found
}

export async function init(bezelsDir, keys) {
  if (process.platform !== 'darwin') {
    throw new Error(
      'init downloads .dmg files and needs hdiutil (macOS). On this platform: download from ' +
      'developer.apple.com/design/resources/, extract the PNGs, then `dkbezeler measure <frame.png>`.'
    )
  }
  // No devices named = fetch the whole catalog. Naming devices (or --all, its
  // explicit spelling) narrows or confirms; the common first run just works.
  const wanted = keys.length ? SOURCES.filter((s) => keys.includes(s.key)) : SOURCES
  const unknown = keys.filter((k) => !SOURCES.some((s) => s.key === k))
  if (unknown.length) {
    throw new Error(`unknown device(s): ${unknown.join(', ')}. Known: ${SOURCES.map((s) => s.key).join(', ')}, or --all`)
  }

  mkdirSync(bezelsDir, { recursive: true })
  let registered = 0

  for (const source of wanted) {
    const url = `${CDN}/${encodeURI(source.dmg)}`
    const dmg = join(tmpdir(), source.dmg)
    console.log(`init: downloading ${source.label} from Apple…`)
    await download(url, dmg)

    const mount = join(tmpdir(), `dkbezeler-mount-${source.key}`)
    execFileSync('hdiutil', ['attach', dmg, '-mountpoint', mount, '-nobrowse', '-quiet', '-readonly'])
    try {
      for (const png of collectPngs(mount)) {
        // Frame files can be large; skip obvious non-frame art (icons, thumbnails).
        if (statSync(png).size < 50_000) continue
        const file = basename(png)
        copyFileSync(png, join(bezelsDir, file))
        try {
          const { w, h, hole } = await registerFrame(bezelsDir, file, file.replace(/\.png$/i, ''))
          console.log(`  ${file}: ${w}x${h}, screen ${hole.w}x${hole.h} at +${hole.x}+${hole.y}`)
          registered++
        } catch (err) {
          // No transparent cutout (e.g. a closed-device glamour shot) — not a frame; drop it.
          rmSync(join(bezelsDir, file))
          console.log(`  ${file}: skipped (${err.message.split('. ')[1] ?? 'no screen cutout'})`)
        }
      }
    } finally {
      execFileSync('hdiutil', ['detach', mount, '-quiet'])
      rmSync(dmg, { force: true })
    }
  }

  if (!registered) {
    throw new Error('no usable frames found — Apple may have changed the dmg layout; measure PNGs manually')
  }
  console.log(`init: ${registered} frame(s) registered in ${join(bezelsDir, 'frames.json')}`)
}
