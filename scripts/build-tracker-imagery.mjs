#!/usr/bin/env node
/**
 * A picture of the thing itself, for every event Tracker has a page for.
 *
 * ## The defect this closes
 *
 * Every deep-sky page — and Venus — showed the same long exposure of the Milky
 * Way over Paranal, because `heroImageryFor` had no case for them and fell
 * through to a generic night sky. Opening M15 and being shown a photograph of
 * somewhere else entirely is worse than showing nothing: it is a picture of the
 * wrong thing, presented as the thing, on the one page whose job is to tell you
 * what you are about to look at.
 *
 * ## Where the pictures come from
 *
 * Three observatory archives — ESA/Hubble, ESO and NOIRLab — which publish
 * under CC BY 4.0 and record, per image, what it is a picture of; and NASA's
 * Photojournal, which is not copyrighted, for a planet no observatory archive
 * has a usable disc of. This script reads each image's own page, checks that the
 * object Tracker means is named there, and only then downloads. The check is the
 * point: it is what makes "a picture of M15" a claim the repository can support
 * rather than one this file asserts.
 *
 * ## Why they are chosen by hand
 *
 * Because "a picture of the object" is not the same as "a picture the archive
 * files under the object". A Hubble close-up of a nebula's inner light-year is
 * genuinely that nebula and genuinely unrecognisable to somebody about to point
 * binoculars at it. Where a wide ground-based frame exists it is preferred, and
 * where the picture is a space-telescope close-up the object's `eye` sentence
 * says so.
 *
 * Usage: node scripts/build-deep-sky-imagery.mjs [--check]
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(projectRoot, "src/data/tracker/heroImagery.json");
const OUT_DIR = path.join(projectRoot, "public/sky");

/**
 * The three archives, and the one fact about each that the licence turns on.
 *
 * All three publish their public images under CC BY 4.0, which asks for the
 * credit line the archive itself gives — which is why the credit is read from
 * the image's page rather than written here.
 */
const ARCHIVES = {
  esahubble: {
    label: "ESA/Hubble",
    page: (id) => `https://esahubble.org/images/${id}/`,
    file: (id, size) => `https://cdn.esahubble.org/archives/images/${size}/${id}.jpg`,
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    termsUrl: "https://esahubble.org/copyright/",
  },
  eso: {
    label: "ESO",
    page: (id) => `https://www.eso.org/public/images/${id}/`,
    file: (id, size) => `https://cdn.eso.org/images/${size}/${id}.jpg`,
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    termsUrl: "https://www.eso.org/public/outreach/copyright/",
  },
  /**
   * NASA's Photojournal, for Venus.
   *
   * The observatory archives have no usable disc of it — Hubble's is 170 pixels
   * across — and a landscape with Venus as a bright point is a picture of a
   * twilight, not of the planet. NASA's media are not copyrighted, which is the
   * same basis the lunar mosaic already ships on.
   */
  nasa: {
    label: "NASA/JPL-Caltech",
    page: (id) => `https://photojournal.jpl.nasa.gov/catalog/${id}`,
    file: (id) =>
      `https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/${id.slice(0, 5).toLowerCase()}/${id.toLowerCase()}/${id}.jpg`,
    licence: "NASA Images and Media Usage Guidelines",
    licenceUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    termsUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    single: true,
  },
  noirlab: {
    label: "NSF NOIRLab",
    page: (id) => `https://noirlab.edu/public/images/${id}/`,
    file: (id, size) => `https://noirlab.edu/public/media/archives/images/${size}/${id}.jpg`,
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    termsUrl: "https://noirlab.edu/public/copyright/",
  },
};

/**
 * What kind of picture each one is, which is what the interface has to declare.
 *
 * Two labels, from one fact, so they cannot drift apart: a Hubble frame is a
 * space-telescope image showing a processed view, a big ground-based frame is a
 * long exposure, and a planetary probe's portrait is neither.
 */
const LOOKS = {
  hubble: { classification: "telescope-image", expectedMode: "processed" },
  ground: { classification: "long-exposure", expectedMode: "long-exposure" },
  spacecraft: { classification: "spacecraft-mosaic", expectedMode: "processed" },
};

/**
 * The picks.
 *
 * `expect` is what the archive must say the picture is of, checked against the
 * page's own object names. `eye` is the one thing no archive can supply: how
 * the view through the reader's own equipment differs from the photograph.
 */
const PICKS = [
  {
    id: "m45",
    look: "ground",
    archive: "noirlab",
    image: "noao-m45",
    expect: ["M 45", "Messier 45", "Pleiades"],
    focusY: "50%",
    eye: "A wide telescope field, exposed long enough to catch the dust the cluster is drifting through. Your eyes see six or seven blue stars in a tight knot and no dust at all; binoculars fill the gap between them with dozens more.",
  },
  {
    id: "m44",
    look: "ground",
    archive: "noirlab",
    image: "noao-m44bash",
    expect: ["M 44", "Messier 44", "Beehive", "Praesepe"],
    focusY: "50%",
    eye: "A photograph reaching far fainter than the eye. From a dark place the Beehive is a small misty patch; binoculars turn the mist into a loose swarm of stars, which is the moment worth going out for.",
  },
  {
    id: "m7",
    look: "ground",
    archive: "eso",
    image: "eso1406a",
    expect: ["M 7", "Messier 7", "NGC 6475"],
    focusY: "50%",
    eye: "A survey telescope's view, with far more background stars than you will see. To the eye M7 is a bright grainy patch low in the south; binoculars resolve its brightest few dozen stars.",
  },
  {
    id: "m31",
    look: "ground",
    archive: "noirlab",
    image: "noao0001a",
    expect: ["M 31", "Messier 31", "Andromeda"],
    focusY: "50%",
    eye: "Hours of exposure, which is where the spiral arms come from. Your eyes get the core only: a soft elongated glow about as long as your little finger at arm's length, with no arms and no colour.",
  },
  {
    id: "ngc0869",
    slug: "double-cluster",
    look: "ground",
    archive: "noirlab",
    image: "noao-hcper",
    // One photograph containing both halves of the Double Cluster, which the
    // archive files under both NGC numbers.
    expect: ["NGC 869"],
    focusY: "50%",
    eye: "Both halves of the Double Cluster in one frame — h Persei is the western of the two. To the naked eye from a dark site the pair is a single brightening in the Milky Way; binoculars separate them into two distinct swarms.",
  },
  {
    id: "ngc0884",
    slug: "double-cluster",
    look: "ground",
    archive: "noirlab",
    image: "noao-hcper",
    expect: ["NGC 884"],
    focusY: "50%",
    eye: "Both halves of the Double Cluster in one frame — χ Persei is the eastern of the two, and the richer of the pair in a small telescope. The naked eye sees one hazy patch; binoculars split it.",
  },
  {
    id: "m42",
    look: "ground",
    archive: "eso",
    image: "eso1103a",
    expect: ["M 42", "Messier 42", "Orion"],
    focusY: "50%",
    eye: "Colour from a long exposure. The eye has almost no colour vision at this light level, so the nebula looks grey-green; what you do see, even in binoculars, is the shape, and the four stars of the Trapezium at its heart.",
  },
  {
    id: "m6",
    look: "ground",
    archive: "noirlab",
    image: "noao-02637",
    expect: ["M 6", "Messier 6", "NGC 6405", "Butterfly"],
    focusY: "50%",
    eye: "More stars than the eye reaches. Binoculars show the two dozen brightest, which is enough for the butterfly shape the name comes from, and one of them is noticeably orange.",
  },
  {
    id: "m35",
    look: "ground",
    archive: "noirlab",
    image: "noao-m35",
    expect: ["M 35", "Messier 35", "NGC 2168"],
    focusY: "50%",
    eye: "The tight knot at the lower right is a second, far more distant cluster, NGC 2158, and it needs a telescope. In binoculars M35 itself is a granular patch the size of the full Moon; a low-power telescope resolves it into a few hundred stars of much the same brightness.",
  },
  {
    id: "m13",
    look: "ground",
    archive: "noirlab",
    image: "noao-m13kpno4m",
    expect: ["M 13", "Messier 13", "NGC 6205", "Hercules"],
    focusY: "50%",
    eye: "A four-metre telescope resolves the core; your telescope will not. Binoculars show a round fuzzy spot, and a small telescope begins to break the outer edges into individual points, which is the thing people remember.",
  },
  {
    id: "m8",
    look: "ground",
    archive: "eso",
    image: "eso1403a",
    expect: ["M 8", "Messier 8", "NGC 6523", "Lagoon"],
    focusY: "50%",
    eye: "Survey-telescope colour. To the eye the Lagoon is a pale grey glow with a dark lane through it and a cluster of stars sitting in it — the shape survives, the red does not.",
  },
  {
    id: "m16",
    look: "ground",
    archive: "noirlab",
    image: "noao-04086",
    expect: ["M 16", "Messier 16", "NGC 6611", "Eagle"],
    focusY: "50%",
    eye: "The pillars in this frame need a large telescope and a long exposure. What you will see is the star cluster, with the nebula around it as a faint haze that a dark sky and a nebula filter improve more than magnification does.",
  },
  {
    id: "m22",
    look: "hubble",
    archive: "esahubble",
    image: "potw1514a",
    expect: ["M 22", "Messier 22", "NGC 6656"],
    focusY: "50%",
    eye: "Hubble, looking straight into the crowded centre. From the ground M22 is a round glow in binoculars — one of the few globulars that starts to look grainy in them — and resolves into stars in a small telescope.",
  },
  {
    id: "m15",
    look: "ground",
    archive: "esahubble",
    image: "heic1321b",
    expect: ["M 15", "Messier 15", "NGC 7078"],
    focusY: "50%",
    eye: "A ground-based wide field, which is much closer to the eyepiece view than a Hubble close-up would be. Binoculars show a small round fuzzy spot with a bright middle; a telescope resolves the outskirts but rarely the dense core.",
  },
  {
    id: "ngc0457",
    look: "ground",
    archive: "noirlab",
    image: "noao-02464",
    expect: ["NGC 457", "Cassiopeia"],
    focusY: "50%",
    eye: "Deeper than the eye reaches, but the shape is the point and it survives: two bright stars at one end, a body of fainter stars trailing away, which almost everybody reads as a figure with two eyes.",
  },
  {
    id: "m92",
    look: "ground",
    archive: "noirlab",
    image: "noao-m92",
    expect: ["M 92", "Messier 92", "NGC 6341"],
    focusY: "50%",
    eye: "A telescope image reaching well past the eye. M92 is smaller and tighter than M13 in the eyepiece — a compact round glow that a moderate telescope begins to resolve at the edges.",
  },
  {
    id: "m81",
    look: "ground",
    archive: "esahubble",
    image: "heic0401e",
    expect: ["M 81", "Messier 81", "NGC 3031"],
    focusY: "50%",
    eye: "A ground-based long exposure, which is where the arms come from. In a small telescope M81 is a bright oval glow with a concentrated middle; the spiral structure needs a large aperture and a dark sky.",
  },
  {
    id: "m27",
    look: "ground",
    archive: "noirlab",
    image: "noao-m27-kpno-mayall-4-m",
    expect: ["M 27", "Messier 27", "NGC 6853", "Dumbbell"],
    focusY: "50%",
    eye: "Four-metre colour. Visually the Dumbbell is grey, but it is one of the few nebulae bright enough to show its shape rather than just its presence — the two-lobed core is visible in a small telescope.",
  },
  {
    id: "ngc7009",
    look: "ground",
    archive: "noirlab",
    image: "noao-02211",
    expect: ["NGC 7009", "Saturn"],
    focusY: "50%",
    eye: "The faint side extensions that gave the nebula its name need a large telescope. At moderate power it is a small, distinctly blue-green oval — bright, but very small.",
  },
  {
    id: "m82",
    look: "hubble",
    archive: "esahubble",
    image: "heic0604a",
    expect: ["M 82", "Messier 82", "NGC 3034", "Cigar"],
    focusY: "50%",
    eye: "Hubble, and the red filaments are hydrogen being blown out of the galaxy. In a telescope M82 is a thin bright streak of light with a mottled texture and a dark notch across the middle.",
  },
  {
    id: "m51",
    look: "hubble",
    archive: "esahubble",
    image: "heic0506a",
    expect: ["M 51", "Messier 51", "NGC 5194", "Whirlpool"],
    focusY: "50%",
    eye: "Hubble's view of the collision. From the ground, a small telescope shows two round glows side by side; seeing the spiral arms that connect them takes a large aperture and a genuinely dark sky.",
  },
  {
    id: "m1",
    look: "hubble",
    archive: "esahubble",
    image: "heic0515a",
    expect: ["M 1", "Messier 1", "NGC 1952", "Crab"],
    focusY: "50%",
    eye: "Hubble's filaments at full stretch. Visually the Crab is a faint grey oval smudge with no structure at all — worth finding for what it is rather than for what it looks like.",
  },
  {
    id: "m104",
    look: "hubble",
    archive: "esahubble",
    image: "opo0328a",
    expect: ["M 104", "Messier 104", "NGC 4594", "Sombrero"],
    focusY: "50%",
    eye: "A Hubble mosaic. In a modest telescope the Sombrero is a small bright lens of light, and the dust lane across it is one of the few such lanes visible in amateur apertures.",
  },
  {
    id: "m57",
    look: "hubble",
    archive: "esahubble",
    image: "heic1310a",
    expect: ["M 57", "Messier 57", "NGC 6720", "Ring"],
    focusY: "50%",
    eye: "Hubble, so the colour and the wisps are real but far beyond the eye. Through a small telescope the Ring is exactly that — a tiny grey smoke ring, unmistakable once found, with the hole in the middle plain at moderate power.",
  },
  {
    id: "ngc6543",
    look: "ground",
    archive: "esahubble",
    image: "heic0414b",
    expect: ["NGC 6543", "Cat's Eye", "Cat’s Eye"],
    focusY: "50%",
    eye: "A ground-based telescope image, closer to the eyepiece view than the Hubble close-up. Visually it is a small, bright, blue-green disc — one of the few objects out here with a colour the eye can actually call a colour.",
  },
  {
    id: "planet-venus",
    look: "spacecraft",
    archive: "nasa",
    image: "PIA23791",
    expect: ["Venus"],
    focusY: "50%",
    /*
      The published frame is two panels — natural colour on the left, contrast
      enhanced on the right — which as a hero reads as two planets. Cropped to
      the left panel, what is left is the one Mariner 10 saw.
    */
    crop: "1085x1096+0+0",
    treatment: "subject",
    eye: "Mariner 10, from close range and in natural colour. To your eyes Venus is a brilliant white point, far brighter than any star and impossible to mistake; a telescope shows a small featureless disc going through phases like the Moon, and never these cloud bands.",
  },
];

/* ------------------------------------------------------------------ fetch */

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "orbit-studio-media-curation/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function fetchBytes(url, timeoutMs = 120_000) {
  const response = await fetch(url, {
    headers: { "user-agent": "orbit-studio-media-curation/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The screen derivative, not the archive master.
 *
 * These heroes are cropped to cover a frame under a thousand CSS pixels wide,
 * and the archives' full-size files run to eleven megabytes — bytes a reader on
 * a phone pays for and never sees. Djangoplicity's `screen` rendition is 1280
 * across, uncropped, and in the same family as the planet heroes already
 * shipping. `large` is the fallback for the rare image that has no `screen`.
 */
const RENDITIONS = ["screen", "large"];

async function fetchImage(archive, id) {
  if (archive.single) {
    const url = archive.file(id);
    return { bytes: await fetchImageChecked(url), rendition: "published", url };
  }
  let last = null;
  for (const size of RENDITIONS) {
    try {
      const bytes = await fetchImageChecked(archive.file(id, size));
      return { bytes, rendition: size, url: archive.file(id, size) };
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error(`no rendition downloaded for ${id}`);
}

/** A redirect to an HTML page is a missing image, whatever status it returns. */
async function fetchImageChecked(url) {
  const bytes = await fetchBytes(url);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`not a JPEG: ${url}`);
  }
  return bytes;
}

const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const entities = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** What the archive itself says this is a picture of. */
function objectNames(page) {
  // Photojournal states the subject in the page title rather than in a table of
  // designations, so the title check below is the whole of the evidence there.
  if (!page.includes("About the Object")) return [];
  const block = page.match(/<h3>About the Object<\/h3>(.*?)<\/table>/s);
  if (!block) return [];
  // Two markups for the same table: ESA/Hubble and ESO use a header cell for
  // the label, NOIRLab a plain one. Reading only the first left three quarters
  // of the picks verified by title alone, which is the weaker evidence.
  const row = block[1].match(/Name:<\/t[hd]>\s*<td>(.*?)<\/td>/s);
  if (!row) return [];
  return strip(row[1])
    .split(",")
    .map((name) => entities(name).trim())
    .filter(Boolean);
}

function pageTitle(page) {
  const match = page.match(/<title>(.*?)<\/title>/s);
  return match
    ? entities(strip(match[1])).replace(/\s*[-|]\s*(ESA\/Hubble|ESO|NOIRLab|NASA Science)\s*$/, "")
    : "";
}

/**
 * Whether the archive says this picture is of that object.
 *
 * Exact on designations, because substring matching is how "M 1" quietly
 * matches M104. The archives differ on spacing — NOIRLab files the Gemini
 * cluster as "M35" and ESA/Hubble writes "M 35" — so the comparison ignores
 * spacing and nothing else. Where an archive keeps no designation list at all
 * the title carries the claim, and there the match is on whole words.
 */
function namesObject(names, title, expected) {
  const flatten = (value) => value.toLowerCase().replace(/[\s.]+/g, "");
  if (names.some((name) => flatten(name) === flatten(expected))) return true;
  const words = expected
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  return new RegExp(`(^|[^\\w])${words}($|[^\\w])`, "i").test(title);
}

function pageCredit(page) {
  const match = page.match(/<div class="credit">(.*?)<\/div>/s);
  if (match) return entities(strip(match[1]));
  // Photojournal's own credit block.
  const nasa = page.match(/<span>Credits?:\s*<\/span>\s*<span>(.*?)<\/span>/s);
  return nasa ? entities(strip(nasa[1])) : "";
}

/* ------------------------------------------------------------------- main */

const check = process.argv.includes("--check");
const work = mkdtempSync(path.join(tmpdir(), "deep-sky-imagery-"));
const manifest = [];
const problems = [];

try {
  for (const pick of PICKS) {
    const archive = ARCHIVES[pick.archive];
    const pageUrl = archive.page(pick.image);
    const page = await fetchText(pageUrl);
    const names = objectNames(page);
    const title = pageTitle(page);
    const credit = pageCredit(page);

    /**
     * The check that makes the claim honest.
     *
     * An archive that has stopped saying this picture is of this object is an
     * archive Tracker can no longer cite for it, and the right response is to
     * fail rather than to ship the picture anyway.
     */
    const matched = pick.expect.some((name) => namesObject(names, title, name));
    if (!matched) {
      problems.push(`${pick.id}: ${pick.archive}/${pick.image} is filed as "${names.join(", ") || title}", which does not name ${pick.expect[0]}`);
      continue;
    }
    if (!credit) {
      problems.push(`${pick.id}: ${pick.archive}/${pick.image} carries no credit line, and CC BY needs one`);
      continue;
    }

    // Named for what the picture is, not for which page asked for it: both
    // halves of the Double Cluster are in one frame, and two copies of one file
    // under two names is two things to keep in step for no gain.
    const slug = (pick.slug ?? pick.id).replace(/^ngc0*/, "ngc").replace(/[^a-z0-9]+/g, "-");
    const file = `${pick.archive}-${pick.image}-${slug}.webp`;
    const thumbFile = `${pick.archive}-${pick.image}-${slug}-thumb.webp`;
    const target = path.join(OUT_DIR, file);
    const thumb = path.join(OUT_DIR, thumbFile);

    const { bytes: source, rendition, url: fileUrl } = await fetchImage(archive, pick.image);
    const sourceSha = createHash("sha256").update(source).digest("hex");
    const jpeg = path.join(work, `${pick.image}.jpg`);
    writeFileSync(jpeg, source);

    if (!check) {
      /* Sized for a hero, not for an archive. See RENDITIONS above. */
      execFileSync("magick", [
        jpeg,
        ...(pick.crop ? ["-crop", pick.crop, "+repage"] : []),
        "-resize", "1280x1280>",
        "-strip",
        "-quality", "78",
        "-define", "webp:method=6",
        target,
      ]);
      /**
       * And a thumbnail, because the rail shows eight of these at once.
       *
       * A rail card's picture is forty pixels across. Handing it the hero file
       * costs a couple of hundred kilobytes per card for detail nobody can see,
       * and the rail is the first thing the map draws — so the small one is a
       * separate file rather than the same file scaled down by the browser.
       */
      execFileSync("magick", [
        target,
        "-resize", "160x160>",
        "-strip",
        "-quality", "72",
        "-define", "webp:method=6",
        thumb,
      ]);
      // magick inherits the process umask, which left these unreadable by the
      // dev server that has to serve them.
      chmodSync(target, 0o644);
      chmodSync(thumb, 0o644);
    }

    const bytes = existsSync(target) ? readFileSync(target) : null;
    const thumbBytes = existsSync(thumb) ? readFileSync(thumb) : null;
    manifest.push({
      id: pick.id,
      src: `/sky/${file}`,
      thumb: `/sky/${thumbFile}`,
      focusY: pick.focusY,
      treatment: pick.treatment ?? "photo",
      classification: LOOKS[pick.look].classification,
      expectedMode: LOOKS[pick.look].expectedMode,
      crop: pick.crop ?? null,
      title,
      credit,
      licence: archive.licence,
      licenceUrl: archive.licenceUrl,
      sourceUrl: pageUrl,
      archive: archive.label,
      archiveNames: names,
      eye: pick.eye,
      sourceUrlFile: fileUrl,
      rendition,
      sourceSha256: sourceSha,
      sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
      bytes: bytes ? bytes.length : null,
      thumbSha256: thumbBytes ? createHash("sha256").update(thumbBytes).digest("hex") : null,
      thumbBytes: thumbBytes ? thumbBytes.length : null,
    });
    console.log(`  ${pick.id.padEnd(9)} ${archive.label.padEnd(12)} ${title}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error("\nRefused:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

if (!check) {
  writeFileSync(
    OUT_JSON,
    `${JSON.stringify(
      {
        format: "orbit-studio-tracker-hero-imagery-v1",
        generatedBy: "scripts/build-tracker-imagery.mjs",
        note: "Each picture is verified against the archive's own record of what the image shows before it is downloaded. Credits are read from the image's page, which is what CC BY 4.0 asks for.",
        images: manifest,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nWrote ${manifest.length} images to ${path.relative(projectRoot, OUT_JSON)}`);
}
