# Orbit Studio deep-sky showpieces

`showpieces.json` is a short, curated list of deep-sky objects, generated from
OpenNGC by `scripts/build-deep-sky-showpieces.mjs`.

- **Source**: OpenNGC by Mattia Verga, `database_files/NGC.csv` and
  `database_files/addendum.csv`. The addendum is read as well as the NGC file
  because the Messier list is not a subset of the NGC — the Pleiades is
  Melotte 22 and has no NGC number.
- **Selection**: editorial and written out by name in the generator. Twenty-six
  objects an experienced observer would actually point somebody at, rather than
  a catalogue. Selection is the only editorial part: every position, magnitude
  and size in the generated file comes from OpenNGC.
- **Reference frame and epoch**: J2000, as OpenNGC publishes it. Right ascension
  and declination are converted from sexagesimal to degrees and rounded to five
  decimals, which is far finer than any of these objects needs.
- **Stored fields**: identifier, common name, designation, object type in plain
  words, J2000 right ascension and declination in degrees, visual magnitude,
  major axis in arcminutes, the equipment tier, and one sentence on what a
  person actually sees.
- **Equipment tier**: assigned by one rule applied uniformly to the object's own
  visual magnitude — `V ≤ 4.5` the unaided eye, `V ≤ 7.0` binoculars, otherwise
  a telescope. Objects with no recorded visual magnitude are dropped rather than
  guessed at, which is why the Rosette, the Veil and the North America Nebula
  are absent despite being showpieces.
- **What the tier does not decide**: whether the reader can see it tonight. That
  is `src/data/tracker/nakedEye.ts`, which knows about their Moon, their
  twilight and their streetlights. Andromeda is a naked-eye object and is not
  visible from a city centre, and both statements have to survive.
- **Generation**: `npm run deepsky:build`. The generator fetches both source
  files, records their SHA-256, and sorts the output deterministically, so the
  same source produces the same bytes.

OpenNGC is distributed under Creative Commons Attribution-ShareAlike 4.0
International. See `LICENSE-CC-BY-SA-4.0.txt`. The generated file remains under
that licence: preserve attribution, the licence link and the description of what
was changed when redistributing it. It is deliberately outside the paths
reserved in `LICENSES.md`, because a share-alike dataset must not be swept into
an all-rights-reserved boundary.
