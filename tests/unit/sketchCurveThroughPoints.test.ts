import { describe, expect, it } from "vitest";
import { curveControls } from "@/lib/sketchPaths";
import { curveStretches, curveThroughPoints } from "@/lib/sketchCurveThroughPoints";
import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/layerling";

const point = (id: string, x: number, z: number): SketchPoint => ({ id, x, z, mode: "corner" });
const line = (startId: string, endId: string): SketchSegment => ({ id: `${startId}${endId}`, startId, endId, kind: "line" });

// An open zigzag a-b-c-d-e of straight lines.
const zigzag = (): SketchProfile => ({
  points: [point("a", 0, 0), point("b", 10, 10), point("c", 20, 0), point("d", 30, 10), point("e", 40, 0)],
  segments: [line("a", "b"), line("b", "c"), line("c", "d"), line("d", "e")],
});

const byId = (profile: SketchProfile, id: string) => profile.points.find((entry) => entry.id === id)!;
const segment = (profile: SketchProfile, id: string) => profile.segments.find((entry) => entry.id === id)!;

/** Every curved side leaves its start towards its end and arrives from its start: no loops. */
function expectNoLoops(profile: SketchProfile, segmentIds: string[]) {
  segmentIds.forEach((id) => {
    const side = segment(profile, id);
    const from = byId(profile, side.startId);
    const to = byId(profile, side.endId);
    const { first, second } = curveControls({ segment: side, from, to });
    expect(first && second).toBeTruthy();
    expect((first!.x - from.x) * (to.x - from.x) + (first!.z - from.z) * (to.z - from.z)).toBeGreaterThan(0);
    expect((to.x - second!.x) * (to.x - from.x) + (to.z - second!.z) * (to.z - from.z)).toBeGreaterThan(0);
  });
}

describe("smooth curve through selected points", () => {
  it("needs 3 points on one outline", () => {
    expect(curveThroughPoints(zigzag(), ["b", "c"])).toBeNull();
    const twoOutlines: SketchProfile = {
      points: [...zigzag().points, point("x", 0, 50), point("y", 10, 50)],
      segments: [...zigzag().segments, line("x", "y")],
    };
    expect(curveThroughPoints(twoOutlines, ["a", "b", "x"])).toBeNull();
  });

  it("curves only between the first and the last selected point", () => {
    const result = curveThroughPoints(zigzag(), ["b", "c", "d"])!;
    expect(result.count).toBe(3);
    const next = result.profile;
    expect(segment(next, "bc").kind).toBe("bezier");
    expect(segment(next, "cd").kind).toBe("bezier");
    expect(segment(next, "ab").kind).toBe("line");
    expect(segment(next, "de").kind).toBe("line");
    expect(byId(next, "c").mode).toBe("smooth");
    // The ends keep their kind and only get the handle facing the curve.
    expect(byId(next, "b").mode).toBe("corner");
    expect(byId(next, "b").handleIn).toBeUndefined();
    expect(byId(next, "d").handleOut).toBeUndefined();
    expect(byId(next, "a")).toEqual(point("a", 0, 0));
    // A smooth point's handles lie in line, on both sides of it.
    const c = byId(next, "c");
    expect(c.handleIn!.x + c.handleOut!.x).toBeCloseTo(c.x * 2);
    expect(c.handleIn!.z + c.handleOut!.z).toBeCloseTo(c.z * 2);
    expectNoLoops(next, ["bc", "cd"]);
  });

  it("takes the points between the selected ones along", () => {
    const next = curveThroughPoints(zigzag(), ["e", "a", "c"])!.profile;
    ["ab", "bc", "cd", "de"].forEach((id) => expect(segment(next, id).kind).toBe("bezier"));
    ["b", "c", "d"].forEach((id) => expect(byId(next, id).mode).toBe("smooth"));
    expectNoLoops(next, ["ab", "bc", "cd", "de"]);
  });

  it("lines up sides stored against the run, so the curve makes no loops", () => {
    const profile = zigzag();
    profile.segments = [line("a", "b"), line("c", "b"), line("c", "d"), line("e", "d")];
    const next = curveThroughPoints(profile, ["a", "b", "c", "d", "e"])!.profile;
    expectNoLoops(next, ["ab", "cb", "cd", "ed"]);
    const b = byId(next, "b");
    expect(b.handleIn!.x + b.handleOut!.x).toBeCloseTo(b.x * 2);
  });

  it("leaves a curve beyond an end as it is", () => {
    const profile = zigzag();
    // a-b is a curve stored from b to a, so it uses b's out handle.
    profile.segments[0] = { id: "ab", startId: "b", endId: "a", kind: "bezier" };
    profile.points[0] = { ...profile.points[0], handleIn: { x: 2, z: 5 } };
    profile.points[1] = { ...profile.points[1], handleOut: { x: 5, z: 12 } };
    const next = curveThroughPoints(profile, ["b", "c", "d"])!.profile;
    expect(byId(next, "b").handleOut).toEqual({ x: 5, z: 12 });
    expect(byId(next, "a")).toEqual(profile.points[0]);
    expectNoLoops(next, ["bc", "cd"]);
  });

  it("makes a whole closed outline round when all its points are selected", () => {
    const square: SketchProfile = {
      points: [point("a", 0, 0), point("b", 10, 0), point("c", 10, 10), point("d", 0, 10)],
      segments: [line("a", "b"), line("b", "c"), line("c", "d"), line("d", "a")],
    };
    const [stretch] = curveStretches(square, ["a", "b", "c", "d"]);
    expect(stretch.closed).toBe(true);
    const next = curveThroughPoints(square, ["a", "b", "c", "d"])!.profile;
    next.points.forEach((entry) => expect(entry.mode).toBe("smooth"));
    next.segments.forEach((entry) => expect(entry.kind).toBe("bezier"));
    expectNoLoops(next, ["ab", "bc", "cd", "da"]);
  });

  it("on a closed outline, takes the short way round the selected points", () => {
    const ids = ["p0", "p1", "p2", "p3", "p4", "p5"];
    const hexagon: SketchProfile = {
      points: ids.map((id, index) => point(id, Math.cos((index * Math.PI) / 3) * 10, Math.sin((index * Math.PI) / 3) * 10)),
      segments: ids.map((id, index) => line(id, ids[(index + 1) % ids.length])),
    };
    const [stretch] = curveStretches(hexagon, ["p5", "p0", "p1"]);
    expect(stretch.closed).toBe(false);
    expect(stretch.points.map((entry) => entry.id)).toEqual(["p5", "p0", "p1"]);
    const next = curveThroughPoints(hexagon, ["p1", "p5", "p0"])!.profile;
    expect(segment(next, "p5p0").kind).toBe("bezier");
    expect(segment(next, "p0p1").kind).toBe("bezier");
    ["p1p2", "p2p3", "p3p4", "p4p5"].forEach((id) => expect(segment(next, id).kind).toBe("line"));
    expect(byId(next, "p0").mode).toBe("smooth");
  });
});
