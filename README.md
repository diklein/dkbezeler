# DKBezeler

Bake screenshots and screen recordings into device bezel frames at build time, extracted from the publishing pipeline behind [diklein.com](https://diklein.com).

A baked asset is a plain file. A framed still is one PNG, transparent outside the device, that sits on any background and travels through any image pipeline like every other image. A framed clip is a light version and a dark version of the mp4, with corners matched to your page backgrounds because H.264 has no alpha.

```sh
npx @diklein/dkbezeler init
npx @diklein/dkbezeler "Screen Recording.mov" --out public/img
```

**Requirements:** Node 18+. Stills need nothing else. Baking *videos* needs [ffmpeg](https://ffmpeg.org) installed on your machine (`brew install ffmpeg` on macOS); the CLI checks and tells you if it is missing.

## How it picks the frame

1. The capture's pixel size is looked up in a device-resolution table (1206x2622 is an iPhone 17 Pro capture, 1320x2868 a Pro Max, and so on). A hit picks the matching registered frame by name.
2. No hit: the frame whose screen cutout is closest in aspect ratio to the capture's, rejected if it is more than 4% off. A phone capture never silently lands in an iPad frame.
3. `--frame <name|png>` overrides everything.

Every bake prints which frame it chose and why.

## Frames

DKBezeler ships no frame art, deliberately. A frame is any PNG of a device with a transparent screen cutout ringed by a solid bezel, and everything DKBezeler knows about one it measures from the file itself, flood-filling the alpha channel to find the exterior and the screen rect. Apple's bezels, Android frames, your own exports, etc. are all the same to it.

`init` fetches Apple's official product bezels onto your machine:

```sh
npx @diklein/dkbezeler init                 # every device in the catalog
npx @diklein/dkbezeler init iphone-17       # or name just the ones you shoot on
npx @diklein/dkbezeler init iphone-16 ipad-pro
```

Apple publishes these as public downloads on their CDN (PNG + Photoshop, no sign-in); init automates the download you would otherwise do by hand at [developer.apple.com/design/resources](https://developer.apple.com/design/resources/), extracts the PNGs into `./bezels/`, measures each one, and writes `bezels/frames.json`. With no arguments it fetches the full catalog (both iPhone families, four iPads, two Watches); that is a heavy first download, so name devices to stay lean. Nothing is redistributed by this package, and Apple's [marketing guidelines](https://developer.apple.com/app-store/marketing/guidelines/) for the bezels are yours to follow. The dmg extraction step needs macOS (`hdiutil`); on other platforms extract the PNGs yourself and register them:

```sh
npx @diklein/dkbezeler measure my-frame.png --name "iPhone 17 Pro"
```

When Apple ships a new device, you never wait for a package update. Download the new bezel from Apple's page, run `measure` on it (the measuring itself is automatic), and bake. A release that adds the device to init's catalog and the resolution table makes it one command for everyone; pull requests for both are welcome.

## Baking

```sh
dkbezeler <input …> [options]

--dir <bezels>     frames dir (default ./bezels)
--frame <name|png> force a frame
--out <dir>        output dir (default alongside the input)
--name <base>      output base name, used verbatim
--bg-light <hex>   video corner color, light version (default #ffffff)
--bg-dark <hex>    video corner color, dark version (default #0f1317)
```

Stills produce `<base>-framed.png`. Videos produce `<base>-light.mp4`, `<base>-dark.mp4`, and matching `.jpg` posters, at the clip's own frame rate capped at 60.

**Video corners must match your page backgrounds.** H.264 has no alpha, so the area outside the device is baked opaque, one version per theme. Corners that don't match the page read as tinted squares. Set your two backgrounds once and every video bake in the project uses them:

```sh
npx @diklein/dkbezeler theme --light "#ffffff" --dark "#0f1317"
```

`--bg-light` / `--bg-dark` override per bake, and a bake that falls back to the defaults says so loudly. One subtlety the defaults encode: near-black values decode about one unit darker through the YUV420 round trip, so set the dark value one step brighter than your CSS background (the default #0f1317 is what actually decodes to #0e1215).

Stills need nothing beyond this package ([sharp](https://sharp.pixelplumbing.com) comes with it). Video input shells out to ffmpeg, which you install yourself (`brew install ffmpeg` on macOS); the CLI tells you if it is missing.

`dkbezeler check <input>` exits 0 when a file looks like a phone capture (portrait, aspect between 1.95 and 2.35, at least 700px wide), for wiring into watchers and hooks.

## Display components

```sh
npx shadcn add https://diklein.com/r/dk-bezeler.json
```

installs `DKBezelImage` and `DKBezelVideo` into `components/dk-bezeler/`. Import the stylesheet once, then:

```tsx
<DKBezelImage src="/img/onboarding-framed.png" width={900} height={1840} alt="Onboarding" />
<DKBezelVideo base="/img/checkout" width={900} height={1840} alt="Checkout flow" />
```

`DKBezelVideo` renders both versions and shows exactly one with CSS, following the shadcn `.dark` convention with a `prefers-color-scheme` fallback. The hidden one is `display:none`, so it never downloads past its header or plays. Both components take a `renderImage` slot or `className` if you want your own image pipeline in the loop.

## Why the bake is pixel-careful

Around a device's rounded corners, the frame's outermost pixels are antialiased, only partially opaque. A naive composite lets the bright screen rectangle show straight through them: invisible on white, a crusty dotted rim on a dark page. Every one of those pixels lies outside the device's silhouette, where nothing should be behind the frame at all, so DKBezeler recomputes them exactly, from the frame's own alpha, on every bake. Baked videos get the same treatment as a final overlay pass, plus explicit frame-rate and color-range handling (full-range phone recordings quietly shift colors on the web's limited-range decode path if you let them).

## License

MIT. Frame art is not included and never touches the package; see Frames above.
