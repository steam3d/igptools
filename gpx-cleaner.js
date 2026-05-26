export const CLEANED_GPX_FILE = "cleaned_route.gpx";
export const CLEANED_GPX_MIME_TYPE = "application/gpx+xml;charset=utf-8";

function localName(element) {
  return element.localName || element.nodeName.split(":").pop();
}

function findElementsByLocalName(root, tagName) {
  const allElements = root.getElementsByTagName("*");
  const matches = [];

  for (const element of Array.from(allElements)) {
    if (localName(element) === tagName) {
      matches.push(element);
    }
  }

  return matches;
}

function findDirectChildrenByLocalName(element, tagName) {
  return Array.from(element.children).filter((child) => localName(child) === tagName);
}

function findFirstDirectChildByLocalName(element, tagName) {
  for (const child of Array.from(element.children)) {
    if (localName(child) === tagName) {
      return child;
    }
  }

  return null;
}

function ensureXmlDocument(xmlText) {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available in this browser.");
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(xmlText).replace(/^\ufeff/, ""), "application/xml");
  const rootElement = documentNode.documentElement;
  const parseErrors = findElementsByLocalName(documentNode, "parsererror");

  if ((rootElement && localName(rootElement) === "parsererror") || parseErrors.length > 0) {
    throw new Error("Invalid GPX/XML file.");
  }

  if (!rootElement || localName(rootElement) !== "gpx") {
    throw new Error("The file must contain a <gpx> root element.");
  }

  return documentNode;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeCoordinate(value, label) {
  const normalized = normalizeText(value);

  if (normalized === "") {
    throw new Error(`${label} is missing.`);
  }

  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number, got ${JSON.stringify(value)}.`);
  }

  return normalized;
}

function readOptionalElevation(element, label) {
  const elevationElement = findFirstDirectChildByLocalName(element, "ele");

  if (!elevationElement) {
    return null;
  }

  const elevationText = normalizeText(elevationElement.textContent);

  if (elevationText === "") {
    return null;
  }

  if (!Number.isFinite(Number.parseFloat(elevationText))) {
    throw new Error(`${label} elevation must be a number, got ${JSON.stringify(elevationText)}.`);
  }

  return elevationText;
}

function readOptionalName(element) {
  const nameElement = findFirstDirectChildByLocalName(element, "name");
  const nameText = normalizeText(nameElement ? nameElement.textContent : "");

  return nameText === "" ? null : nameText;
}

function readPoint(element, pointLabel, keepName = false) {
  const latText = normalizeCoordinate(element.getAttribute("lat"), `${pointLabel} latitude`);
  const lonText = normalizeCoordinate(element.getAttribute("lon"), `${pointLabel} longitude`);

  return {
    latText,
    lonText,
    eleText: readOptionalElevation(element, pointLabel),
    name: keepName ? readOptionalName(element) : null,
  };
}

function readWaypoints(rootElement) {
  return findDirectChildrenByLocalName(rootElement, "wpt").map((element, index) =>
    readPoint(element, `Waypoint ${index + 1}`, true)
  );
}

function readRoutes(rootElement) {
  return findDirectChildrenByLocalName(rootElement, "rte").map((routeElement, routeIndex) => ({
    points: findDirectChildrenByLocalName(routeElement, "rtept").map((pointElement, pointIndex) =>
      readPoint(pointElement, `Route ${routeIndex + 1} point ${pointIndex + 1}`)
    ),
  })).filter((route) => route.points.length > 0);
}

function readTracks(rootElement) {
  return findDirectChildrenByLocalName(rootElement, "trk").map((trackElement, trackIndex) => ({
    segments: findDirectChildrenByLocalName(trackElement, "trkseg").map((segmentElement, segmentIndex) => ({
      points: findDirectChildrenByLocalName(segmentElement, "trkpt").map((pointElement, pointIndex) =>
        readPoint(pointElement, `Track ${trackIndex + 1} segment ${segmentIndex + 1} point ${pointIndex + 1}`)
      ),
    })).filter((segment) => segment.points.length > 0),
  })).filter((track) => track.segments.length > 0);
}

function buildWaypointLines(waypoint) {
  const lines = [
    `  <wpt lat="${escapeXml(waypoint.latText)}" lon="${escapeXml(waypoint.lonText)}">`,
  ];

  if (waypoint.eleText !== null) {
    lines.push(`    <ele>${escapeXml(waypoint.eleText)}</ele>`);
  }

  if (waypoint.name !== null) {
    lines.push(`    <name>${escapeXml(waypoint.name)}</name>`);
  }

  lines.push("  </wpt>");
  return lines;
}

function buildRoutePointLines(point) {
  const lines = [
    `    <rtept lat="${escapeXml(point.latText)}" lon="${escapeXml(point.lonText)}">`,
  ];

  if (point.eleText !== null) {
    lines.push(`      <ele>${escapeXml(point.eleText)}</ele>`);
  }

  lines.push("    </rtept>");
  return lines;
}

function buildRouteLines(route) {
  const lines = ["  <rte>"];

  route.points.forEach((point) => {
    lines.push(...buildRoutePointLines(point));
  });

  lines.push("  </rte>");
  return lines;
}

function buildTrackPointLines(point) {
  const lines = [
    `      <trkpt lat="${escapeXml(point.latText)}" lon="${escapeXml(point.lonText)}">`,
  ];

  if (point.eleText !== null) {
    lines.push(`        <ele>${escapeXml(point.eleText)}</ele>`);
  }

  lines.push("      </trkpt>");
  return lines;
}

function buildTrackSegmentLines(segment) {
  const lines = ["    <trkseg>"];

  segment.points.forEach((point) => {
    lines.push(...buildTrackPointLines(point));
  });

  lines.push("    </trkseg>");
  return lines;
}

function buildTrackLines(track) {
  const lines = ["  <trk>"];

  track.segments.forEach((segment) => {
    lines.push(...buildTrackSegmentLines(segment));
  });

  lines.push("  </trk>");
  return lines;
}

function countElevations(waypoints, routes, tracks) {
  const waypointElevations = waypoints.filter((waypoint) => waypoint.eleText !== null).length;
  const routeElevations = routes.reduce(
    (sum, route) => sum + route.points.filter((point) => point.eleText !== null).length,
    0
  );
  const trackElevations = tracks.reduce(
    (sum, track) => sum + track.segments.reduce(
      (segmentSum, segment) => segmentSum + segment.points.filter((point) => point.eleText !== null).length,
      0
    ),
    0
  );

  return waypointElevations + routeElevations + trackElevations;
}

export function buildCleanedGpxDownloadName(sourceFileName = "") {
  const normalized = String(sourceFileName).trim();
  const baseName = normalized.replace(/\.[^.]+$/u, "").trim() || "route";

  return `cleaned_${baseName}.gpx`;
}

export function cleanGpxText(xmlText) {
  const documentNode = ensureXmlDocument(xmlText);
  const rootElement = documentNode.documentElement;
  const waypoints = readWaypoints(rootElement);
  const routes = readRoutes(rootElement);
  const tracks = readTracks(rootElement);

  if (waypoints.length === 0 && routes.length === 0 && tracks.length === 0) {
    throw new Error("Nothing to keep. GPX file does not contain POI, routes, or tracks.");
  }

  const body = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<gpx",
    "  version=\"1.1\"",
    "  creator=\"iGPTOOLS GPX Cleaner\"",
    "  xmlns=\"http://www.topografix.com/GPX/1/1\"",
    "  xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
    "  xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\"",
    ">",
  ];

  waypoints.forEach((waypoint) => {
    body.push(...buildWaypointLines(waypoint));
  });

  routes.forEach((route) => {
    body.push(...buildRouteLines(route));
  });

  tracks.forEach((track) => {
    body.push(...buildTrackLines(track));
  });

  body.push("</gpx>");

  const routePointsCount = routes.reduce((sum, route) => sum + route.points.length, 0);
  const trackSegmentsCount = tracks.reduce((sum, track) => sum + track.segments.length, 0);
  const trackPointsCount = tracks.reduce(
    (sum, track) => sum + track.segments.reduce((segmentSum, segment) => segmentSum + segment.points.length, 0),
    0
  );

  return {
    gpxText: `${body.join("\n")}\n`,
    summary: {
      waypointsCount: waypoints.length,
      routesCount: routes.length,
      routePointsCount,
      tracksCount: tracks.length,
      trackSegmentsCount,
      trackPointsCount,
      elevationsCount: countElevations(waypoints, routes, tracks),
    },
  };
}
