# Steward brand system

This document is the brand authority for the shipped Steward UI and its launch assets. Product structure and component behavior remain governed by the Phase 3 UI specification.

## Brand idea

Steward returns ownership of local computing capability to the person who owns the computer. The estate belongs to the user; Steward is the invisible capability that keeps it running.

The estate metaphor sets the scene. It does not decorate the tool.

### Feeling

- Capable
- Composed
- Human

Steward must never feel:

- Flashy
- Robotic
- Quaint

The product is a serious utility first. Technology is expressed through commands, local execution, verification evidence, speed, and zero-model reruns. Humanity appears in the presentation.

## Tagline

**Your computer already knows how.**

This is the sole hero tagline.

## Color

| Token | Hex | Role |
| --- | --- | --- |
| Paper | `#F3EEE3` | Primary background |
| Ink | `#25231F` | Primary text and crisp interface detail |
| Sky | `#78A8C8` | Atmosphere, imagery, and large decorative areas only; never functional text |
| Deep Sky | `#355F78` | Buttons, links, focus, and functional accent text |
| Ember | `#BE3F0C` | Struck-through subscription prices and the kill counter only |

Sky is the emotional signature; Deep Sky is its functional counterpart. Ember is Monet's warm counterpoint inside the cool light. It is not a general accent and must not spread to calls to action, badges, errors, or decoration.

Impressionist artwork may contain garden green, dusty rose, gold, and additional pigment colors. These colors stay inside imagery and never become UI-control colors.

Evidence green and failure red remain the functional colors defined by the UI specification. They are not brand colors and must not be recolored to fit this palette.

## Typography

No webfonts.

| Role | Stack | Use |
| --- | --- | --- |
| Display serif | `ui-serif, "New York", Georgia, serif` | Wordmark, hero, empty-state headline, major section titles |
| Interface sans | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif` | All operational UI and body copy |
| Machine mono | `ui-monospace, "SF Mono", Menlo, Monaco, monospace` | Real commands, paths, dimensions, timings, and model-call counts |

New York is editorial rather than bookish or classical. Use regular or semibold, sentence case, with no decorative italics.

The active workflow is approximately 90% interface sans. Serif and imagery belong to entry moments and major headings. Mono is evidence of real machine activity, never technological garnish.

## Wordmark

The wordmark is **Steward**: bare, title case, and without punctuation.

- Text only, set in New York Semibold
- No crest, key, villa, leaf, sparkle, or separate conceptual symbol
- The macOS app icon may use the wordmark's **S** as a monogram

## Imagery

Imagery is evocative, not literal. It shows the user's estate from an owner's point of view: cultivated landscape, villa, groves, paths, garden, sky, and water rendered with Impressionist light and broken brushwork.

Never depict Steward as a person. Do not use servants, uniforms, keys, crests, heraldry, manor-house cosplay, or faux-historical interface elements.

Imagery ships in exactly three places:

1. Drop-zone empty state
2. README header
3. Video title card

Once a task begins, imagery disappears and the interface becomes clean and operational.

## Texture

Halftone is an image treatment, never a UI surface.

Allowed:

- On the three approved imagery assets only
- As a restrained print-reproduction layer that preserves Impressionist brushwork
- At softly fading artwork edges rather than inside hard poster-like rectangles
- As a fixed texture; never animated grain

Banned:

- Behind or over text, buttons, inputs, commands, prices, or counters
- Anywhere in task execution, evidence, checks, errors, or results
- Full-window paper grain, textured cards, or decorative UI noise
- Heavy halftone that obscures color, light, or brushwork

Legibility is sacred. The operational interface remains perfectly crisp.

## Voice

Steward speaks like a trusted operator: calm, brief, and specific.

- Do not use “I,” “we,” or simulated personality
- Do not use “Oops,” exclamation marks, AI jargon, or claims of magic
- State what happened, show proof, then give the next action
- Human means considerate, not chatty
- Never promise a state or action the executor does not support
- Every number in UI copy must come directly from check evidence (`expected` and `actual`), never from UI-composed claims
- A failed check always means the failed output is discarded; copy must never offer to keep it

### Approved voice examples

Empty state:

> Drop a file. Tell Steward what you need.

Running:

> Compressing locally.

Verified:

> Verified: 84 MB → 18 MB. Original unchanged.

The values in this pattern must be populated from check evidence.

Recipe saved:

> Recipe saved. Future runs use zero model calls.

Failed check and repair:

> Duration check failed: expected 6.0s, got 3.8s. Output discarded. Retrying with a revised plan (attempt 2 of 3).

## Midjourney asset briefs

Append the chosen style-reference codes to each brief. Generate artwork without text, logos, interface controls, borders, or mockups; typography is applied separately on solid Paper.

### 1. Drop-zone empty-state illustration

**Purpose:** A quiet invitation before the user begins. The art disappears when work starts.

**Prompt brief:**

> An owner's view into a cultivated estate garden at clear morning light, a modest villa glimpsed beyond soft groves, a path leading inward, luminous dreamlike sky reflected in a small pond, late-nineteenth-century French Impressionist oil painting, broken visible brushwork, Paper cream, Sky blue and garden green with one tiny warm sunset-orange counterpoint, composed and spacious, no people, no text, no objects associated with servants, edges dissolving naturally into a warm paper field, restrained halftone print reproduction overlay that preserves the brushwork --ar 4:3

**Composition:** Keep the center calm; the illustration sits apart from the empty-state copy, never behind it.

### 2. README header

**Purpose:** Establish ownership, local capability, and the estate metaphor at first glance.

**Prompt brief:**

> Wide panoramic owner's view across a living estate, villa, orchards and cultivated paths under a vast lucid blue sky, human-scale rather than aristocratic, French Impressionist oil painting with shifting natural light and broken pigment strokes, cool Sky and Deep Sky balanced by sparse dusty rose and sunset orange, timeless art-book editorial restraint, no people, no text, no heraldry, no technology, no frame, subtle fixed halftone reproduction texture, outer edges fading to warm Paper --ar 3:1

**Composition:** Preserve a clean Paper zone for separately typeset wordmark and tagline; never place copy over textured art.

### 3. Video title-card artwork

**Purpose:** The strongest cinematic expression of the brand before the product demonstration becomes crisp and functional.

**Prompt brief:**

> Cinematic Impressionist view from a shaded grove toward a sunlit villa and clear dreamlike sky, cultivated landscape belonging to the viewer, cool luminous blue atmosphere interrupted by one deliberate warm ember reflection at sunset, confident quiet composition, visible oil brushwork, art-book quality, no people, no text, no crest, no fantasy architecture, no UI, restrained halftone print reproduction treatment, artwork concentrated on the left and dissolving into untextured warm Paper on the right --ar 16:9

**Composition:** Typeset **Steward** and **Your computer already knows how.** only in the solid Paper zone. Do not overlay type on the artwork.
