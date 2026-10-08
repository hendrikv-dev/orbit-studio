/**
 * Not beside the function it tests, and that is deliberate.
 *
 * Netlify treats every top-level file in the configured functions directory as
 * a deployable function, and derives the function's name from the file's
 * basename minus its final extension. `goes-cloud-mask.test.ts` therefore
 * became a function named `goes-cloud-mask.test`, whose dot is not legal in a
 * function name, and the deploy was rejected with:
 *
 *   The following serverless functions failed to deploy: goes-cloud-mask.test
 *
 * Local bundling does not catch it. `netlify build` packaged both files
 * happily, producing `goes-cloud-mask.zip` and `goes-cloud-mask.test.zip`; the
 * name is only rejected server-side at deploy. So the file lives outside the
 * deployable tree, and `npm run netlify:functions:verify` fails the build if a
 * test, fixture or helper ever appears in there again.
 *
 * The rest of the repository colocates tests with their source. This one
 * cannot, because the directory it would sit in is a deployment surface.
 */
import { describe, expect, it } from "vitest";

import {
  chunks,
  inBatches,
  readMetadata,
  satelliteFor,
  startedAt,
  strideFor,
} from "../functions/goes-cloud-mask.mts";

describe("choosing a spacecraft", () => {
  it("takes the one nearer the sub-point", () => {
    expect(satelliteFor(-122.7)).toBe("west");
    expect(satelliteFor(-74)).toBe("east");
    expect(satelliteFor(-105.1)).toBe("west");
    expect(satelliteFor(-104.9)).toBe("east");
  });

  it("reads a longitude in whatever form a map hands it", () => {
    expect(satelliteFor(-122.7 + 360)).toBe("west");
    expect(satelliteFor(-74 - 720)).toBe("east");
  });
});

describe("the scan time in a file name", () => {
  /**
   * `_s20262460726172` is year 2026, day 246, 07:26:17.2 UTC. Taking it from
   * the name means the catalogue alone is enough to choose a granule, which is
   * one request rather than one per candidate.
   */
  it("decodes the ABI naming convention", () => {
    expect(startedAt("OR_ABI-L2-ACMC-M6_G19_s20262460726172_e20262460728545_c20262460729305.nc")).toBe(
      "2026-09-03T07:26:17.200Z",
    );
    // Day one is 1 January, not the zeroth of January.
    expect(startedAt("OR_ABI-L2-ACMC-M6_G18_s20260010000000_e1_c1.nc")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses a name it does not recognise", () => {
    expect(startedAt("something-else.nc")).toBeNull();
  });
});

describe("reading the DAP4 wire format", () => {
  const frame = (flags: number, body: Uint8Array) => {
    const head = new Uint8Array(4);
    head[0] = flags;
    head[1] = (body.length >> 16) & 0xff;
    head[2] = (body.length >> 8) & 0xff;
    head[3] = body.length & 0xff;
    return new Uint8Array([...head, ...body]);
  };

  it("separates the metadata chunk from the values", () => {
    const dmr = new TextEncoder().encode("<Dataset/>");
    const data = new Uint8Array([2, 1, 0, 3]);
    const read = chunks(new Uint8Array([...frame(0x04, dmr), ...frame(0x01, data)]));
    expect(read.dmr).toBe("<Dataset/>");
    expect([...read.data]).toEqual([2, 1, 0, 3]);
    expect(read.bigEndian).toBe(false);
  });

  it("joins values split across several chunks", () => {
    const dmr = new TextEncoder().encode("<Dataset/>");
    const read = chunks(
      new Uint8Array([
        ...frame(0x04, dmr),
        ...frame(0x00, new Uint8Array([1, 2])),
        ...frame(0x01, new Uint8Array([3, 4])),
      ]),
    );
    expect([...read.data]).toEqual([1, 2, 3, 4]);
  });

  /**
   * Byte order is declared per chunk, and it matters: `Cloud_Probabilities` is
   * a uint16, and reading it the wrong way round turns a clear pixel into a
   * near-certain cloud.
   */
  it("notices when the server declares big-endian", () => {
    const dmr = new TextEncoder().encode("<Dataset/>");
    const read = chunks(new Uint8Array([...frame(0x04, dmr), ...frame(0x03, new Uint8Array([0, 1]))]));
    expect(read.bigEndian).toBe(true);
  });
});

describe("how fine to ask", () => {
  /**
   * A stride skips pixels; it never averages them. So every value that comes
   * back is one NOAA published, and asking for more detail is a matter of
   * asking for a smaller stride rather than of undoing a mean.
   */
  it("asks at native resolution when the window is small enough", () => {
    expect(strideFor(50, 50, 120)).toBe(1);
    expect(strideFor(120, 120, 120)).toBe(1);
  });

  it("coarsens only as far as it must", () => {
    expect(strideFor(240, 240, 120)).toBe(2);
    expect(strideFor(1500, 2500, 120)).toBeGreaterThan(2);
    // And never further than it must: one step finer would exceed the budget.
    const stride = strideFor(1500, 2500, 120);
    expect(Math.ceil(1500 / (stride - 1)) * Math.ceil(2500 / (stride - 1))).toBeGreaterThan(120 * 120);
  });
});

describe("reading a granule's own constants", () => {
  const DMR = `<Dataset>
    <Dimension name="y" size="1500"/>
    <Dimension name="x" size="2500"/>
    <Int16 name="x"><Attribute name="scale_factor" type="Float64"><Value value="5.6E-5"/></Attribute>
      <Attribute name="add_offset" type="Float64"><Value value="-0.101332"/></Attribute></Int16>
    <Int16 name="y"><Attribute name="scale_factor" type="Float64"><Value value="-5.6E-5"/></Attribute>
      <Attribute name="add_offset" type="Float64"><Value value="0.128212"/></Attribute></Int16>
    <UInt16 name="Cloud_Probabilities"><Attribute name="scale_factor" type="Float64"><Value value="1.5261E-5"/></Attribute></UInt16>
    <Int32 name="goes_imager_projection">
      <Attribute name="semi_major_axis" type="Float64"><Value value="6378137.0"/></Attribute>
      <Attribute name="semi_minor_axis" type="Float64"><Value value="6356752.31414"/></Attribute>
      <Attribute name="perspective_point_height" type="Float64"><Value value="3.5786023E7"/></Attribute>
      <Attribute name="longitude_of_projection_origin" type="Float64"><Value value="-137.0"/></Attribute>
    </Int32>
    <Attribute name="time_coverage_start" type="String"><Value value="2026-09-03T07:26:17.4Z"/></Attribute>
    <Attribute name="platform_ID" type="String"><Value value="G18"/></Attribute>
    <Attribute name="scene_id" type="String"><Value value="CONUS"/></Attribute>
    <Attribute name="spatial_resolution" type="String"><Value value="2.0km at nadir"/></Attribute>
  </Dataset>`;

  /**
   * Every constant comes from the granule rather than from memory. The two
   * spacecraft sit over different longitudes, their scene windows differ, and
   * the grid has been redefined before — a remembered constant would be wrong
   * silently and only for one of them.
   */
  it("takes the projection, the grid and the scaling from the file", () => {
    const meta = readMetadata(DMR);
    expect(meta.grid.originLongitudeDeg).toBe(-137);
    expect(meta.grid.columns).toBe(2500);
    expect(meta.grid.rows).toBe(1500);
    expect(meta.grid.xScaleRad).toBeCloseTo(5.6e-5, 10);
    expect(meta.grid.yScaleRad).toBeCloseTo(-5.6e-5, 10);
    expect(meta.probabilityScale).toBeCloseTo(1.5261e-5, 10);
    expect(meta.observedUtc).toBe("2026-09-03T07:26:17.4Z");
    expect(meta.platform).toBe("G18");
    expect(meta.resolution).toBe("2.0km at nadir");
  });
});

describe("batching the walk over granules", () => {
  it("keeps the order of the results", async () => {
    const order = await inBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => n * 2);
    expect(order).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("never has more than the batch width in flight", async () => {
    let live = 0;
    let peak = 0;
    await inBatches(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return null;
    });
    // Unidata asks consumers not to scrape, and the provenance entry promises
    // requests stay subset rather than bulk. Two dozen simultaneous hits on a
    // free academic service is the thing that promise is about.
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("does nothing with nothing", async () => {
    expect(await inBatches([], 3, async () => 1)).toEqual([]);
  });
});
