import type { ReactNode } from 'react'

/* Display components for DKBezeler's baked outputs. Both are deliberately plain:
 * the bake did the hard part, so a framed still is just an image and a framed clip
 * is just a pair of videos. No dependencies, no client JS. */

export interface DKBezelImageProps {
  /** The baked -framed.png. */
  src: string
  alt?: string
  /** Intrinsic pixels of the baked PNG (dkbezeler prints them). Declaring them
   *  reserves layout before the file arrives. */
  width: number
  height: number
  /** Display width cap. The bake is transparent outside the device, so it sits on
   *  any background. */
  maxWidth?: number
  className?: string
  /** Render the image yourself (e.g. with next/image). */
  renderImage?: (src: string, ctx: { alt: string; className: string }) => ReactNode
}

export function DKBezelImage({ src, alt, width, height, maxWidth = 460, className, renderImage }: DKBezelImageProps) {
  return (
    <figure className={`dkbz-figure${className ? ` ${className}` : ''}`} style={{ maxWidth }}>
      {renderImage ? (
        renderImage(src, { alt: alt ?? '', className: 'dkbz-img' })
      ) : (
        <img src={src} alt={alt ?? ''} width={width} height={height} className="dkbz-img" loading="lazy" />
      )}
    </figure>
  )
}

export interface DKBezelVideoProps {
  /** Base path of the baked pair: `${base}-light.mp4`, `${base}-dark.mp4` and the
   *  matching .jpg posters, exactly as dkbezeler wrote them. */
  base: string
  /** Accessible label for the clip. */
  alt?: string
  /** Intrinsic pixels of the baked masters (dkbezeler prints them). Declares the
   *  aspect ratio so the box holds its size before video metadata arrives (a bare
   *  <video> is 300x150 until then, which costs CLS). */
  width: number
  height: number
  maxWidth?: number
  className?: string
}

/**
 * H.264 has no alpha, so the bake writes a light and a dark master with corners
 * matched to each theme's page background. Both render; CSS shows exactly one
 * (`.dark` class convention, falling back to prefers-color-scheme). The hidden one
 * is display:none, so it never fetches past metadata or plays.
 */
export function DKBezelVideo({ base, alt, width, height, maxWidth = 460, className }: DKBezelVideoProps) {
  return (
    <figure className={`dkbz-figure${className ? ` ${className}` : ''}`} style={{ maxWidth }}>
      {(['light', 'dark'] as const).map((theme) => (
        <video
          key={theme}
          className={`dkbz-video dkbz-${theme}`}
          src={`${base}-${theme}.mp4`}
          poster={`${base}-${theme}.jpg`}
          style={{ aspectRatio: `${width} / ${height}` }}
          autoPlay
          muted
          loop
          playsInline
          aria-label={alt}
        />
      ))}
    </figure>
  )
}
