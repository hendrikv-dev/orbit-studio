# Delivering the light-pollution archive

Tracker's light-pollution layer reads measured upward radiance from EOG's VIIRS
annual composite at the product's own 15 arc-second grid. The result is a
47.8 MB numeric archive. This document says what that archive is, how it is
built, where it is served from, and what a maintainer has to do to publish a
new one.

The authority for licence, source and checksums remains
`provenance/inventory.json`. This document is about delivery.

## What the archive is

Two files, produced together and always deployed together.

| File | Size | What it is |
| --- | --- | --- |
| `light-pollution-v21-2024.json` | 0.39 MB | The index: format, scale, source citation, the blob's checksum, and a byte offset and length for every tile that exists |
| `light-pollution-v21-2024.bin` | 47.75 MB | The tiles themselves, concatenated |

The name carries its own provenance: `v21` is the EOG product version and
`2024` the composite year. A new composite is a **new pair of objects**, never
an overwrite, which is what makes both URLs safe to cache forever.

### The format

`tracker-light-pollution/1`. Web Mercator XYZ tiles, 256×256, zoom 0 to 8,
stored as PNGs inside one blob. Radiance is carried in the red and green
channels as a high and a low byte and divided by `scale` on read — a 16-bit
greyscale PNG would have been 8% smaller and is silently truncated to eight
bits by the canvas that decodes it, which is a quiet loss of exactly the
precision the archive exists to preserve.

The archive is **sparse**. Only 2.6% of the source's valid pixels carry any
light, so a tile that is absent from the index is not a gap: it means no
artificial light was detected anywhere in it, and the reader gets that answer
without a request.

### Why it is read in ranges

Because the index names every tile's exact position, the browser fetches a few
kilobytes for the tiles on screen instead of the whole file. A typical map view
costs tens of kilobytes. This is why the object must be served by a host that
honours HTTP `Range`, and why the CORS policy below has to expose
`Content-Range`: a host that answers `200` with the whole body, or a policy
that hides the range headers, turns every tile into a 47.8 MB download.

## Building it

Requires the source GeoTIFF from the Earth Observation Group (a free account),
`rasterio`, and about twenty minutes.

```bash
python3 scripts/build-light-pollution-tiles.py \
  --source VNL_v21_npp_2024_global_vcmslcfg_c202402081600.average.dat.tif
```

It writes both files into `public/tracker/` and prints their sizes. The tile
order is deterministic — a sorted key walk — so the same source produces the
same bytes and therefore the same `blobSha256`.

Check the result before publishing anything:

```bash
npm run lightpollution:archive
```

That verifies the index parses, the blob is the length the index claims, every
tile range lies inside it, the tiles account for every byte with none spare,
and the bytes hash to the recorded digest.

## Where it is served from

**The blob is not in source control.** `.gitignore` excludes
`public/tracker/*.bin`: it is derived data, it is larger than a repository
should carry, and everything needed to reproduce it — the source URL, the
checksum, the transformation and this document — is tracked. The index is
tracked, because it is small and changes with the code that reads it.

**The blob is not in the deployment bundle either.** Cloudflare Pages rejects
single assets over 25 MiB, and a file that changes once a year has no business
being re-uploaded on every deploy. Production serves both objects from
Cloudflare R2.

Development needs no configuration: with `VITE_LIGHT_POLLUTION_BASE` unset the
app reads `/tracker/`, which is the copy on disk.

## Publishing a new archive

`node scripts/deploy/light-pollution-archive.mjs --steps` prints these with the
current file names, sizes and checksums filled in.

1. **Create the bucket**, once.

   ```bash
   npx wrangler r2 bucket create orbit-studio-data
   ```

2. **Upload both objects**, typed and immutable.

   ```bash
   npx wrangler r2 object put orbit-studio-data/tracker/light-pollution-v21-2024.bin \
     --file public/tracker/light-pollution-v21-2024.bin \
     --content-type application/octet-stream \
     --cache-control "public, max-age=31536000, immutable"
   ```

   ```bash
   npx wrangler r2 object put orbit-studio-data/tracker/light-pollution-v21-2024.json \
     --file public/tracker/light-pollution-v21-2024.json \
     --content-type application/json \
     --cache-control "public, max-age=31536000, immutable"
   ```

3. **Give the bucket a public address.** Either the managed `r2.dev`
   subdomain or, for production, a custom domain connected in the bucket's
   settings. Both serve range requests. Neither needs a credential in the
   client: these are public, read-only, CC BY 4.0 measurements, and no key of
   any kind is shipped to the browser.

4. **Set the CORS policy**, in the bucket's settings. Range requests need the
   request header allowed *and* the response headers exposed.

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-site-domain>"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range"],
       "ExposeHeaders": ["Content-Range", "Content-Length", "ETag", "Accept-Ranges"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

5. **Point the build at it.** In the Pages project's build environment:

   ```
   VITE_LIGHT_POLLUTION_BASE=https://<your-r2-public-domain>/tracker/
   ```

6. **Prove it arrived.**

   ```bash
   node scripts/deploy/light-pollution-archive.mjs --verify https://<your-r2-public-domain>/tracker/
   ```

   This does not stop at a `HEAD`. It checks that the published index describes
   the same archive by checksum, that the blob advertises `Accept-Ranges` and
   is cacheable, that a real tile from the middle of the file comes back as
   `206` rather than `200`, that `Content-Range` is exposed to the browser, and
   that the bytes returned are byte-for-byte the ones the local archive holds.

## What is not done here

No archive has been uploaded from this repository. There are no Cloudflare
credentials in the development environment and this project does not want any:
the upload is two commands run by a maintainer against their own account, and
the script above deliberately holds no keys and calls no API. What is
implemented is everything around it — the configurable base URL, the checksum
in the index, the local validation, the published-archive verification, and the
behaviour when the archive cannot be reached.

## When it cannot be reached

The layer says so. `loadLightPollution` throws on a failed index fetch, the
query surfaces the error, and the Layers panel marks the row
`Measurements unavailable` rather than leaving a control that looks on and
draws nothing — which, for this layer, would read as "no artificial light
here". The map's other layers, the observing rail and the event overlays are
unaffected: nothing else depends on this archive.
