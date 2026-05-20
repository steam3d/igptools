export const LOCATION_FILE = "location.dat";
export const NAMES_FILE = "point_name_list.dat";
export const MAX_POINT_COUNT = 20;
export const MIN_SLOT_COUNT = 20;
export const TAIL_BYTES = 4;
export const COORD_SCALE = 10_000_000;
export const GPX_FILE = "points.gpx";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

function trimCharacters(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join("");
}

function normalizeName(name, pointNumber, trimName = null) {
  let normalized = (name ?? "").trim();

  if (!normalized) {
    normalized = `Point${pointNumber}`;
  }

  if (trimName !== null) {
    normalized = trimCharacters(normalized, trimName);
  }

  return normalized;
}

function parseCoordinate(text, lineno, fieldName) {
  const value = Number.parseFloat(text);

  if (!Number.isFinite(value)) {
    throw new Error(`Line ${lineno}: ${fieldName} must be a number, got ${JSON.stringify(text)}.`);
  }

  return value;
}

function roundHalfEven(value) {
  const absolute = Math.abs(value);
  const integerPart = Math.floor(absolute);
  const fraction = absolute - integerPart;
  const epsilon = 1e-10;
  let rounded = integerPart;

  if (fraction > 0.5 + epsilon) {
    rounded = integerPart + 1;
  } else if (Math.abs(fraction - 0.5) <= epsilon) {
    rounded = integerPart % 2 === 0 ? integerPart : integerPart + 1;
  }

  if (rounded === 0) {
    return 0;
  }

  return value < 0 ? -rounded : rounded;
}

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

function findFirstChildTextByLocalName(element, tagName) {
  for (const child of Array.from(element.children)) {
    if (localName(child) === tagName) {
      return child.textContent;
    }
  }

  return null;
}

function ensureXmlDocument(xmlText) {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available in this browser.");
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xmlText, "application/xml");
  const rootElement = documentNode.documentElement;
  const parseErrors = findElementsByLocalName(documentNode, "parsererror");

  if ((rootElement && localName(rootElement) === "parsererror") || parseErrors.length > 0) {
    throw new Error("Invalid GPX/XML file.");
  }

  return documentNode;
}

export function parsePointsText(text, trimName = null) {
  const points = [];
  const lines = text.split(/\r\n?|\n/);

  lines.forEach((rawLine, index) => {
    const lineno = index + 1;
    const line = rawLine.trim().replace(/^\ufeff/, "");

    if (!line) {
      return;
    }

    const parts = line.split(";").map((part) => part.trim());

    if (parts.length > 0 && parts[parts.length - 1] === "") {
      parts.pop();
    }

    if (parts.length !== 3) {
      throw new Error(
        `Line ${lineno}: expected "name;lat;lon;" or "name;lat;lon", got ${JSON.stringify(rawLine)}.`
      );
    }

    const [nameText, latText, lonText] = parts;

    points.push({
      id: points.length + 1,
      name: normalizeName(nameText, points.length + 1, trimName),
      lat: parseCoordinate(latText, lineno, "latitude"),
      lon: parseCoordinate(lonText, lineno, "longitude"),
    });
  });

  return points;
}

export function parseGpxText(xmlText, trimName = null) {
  const documentNode = ensureXmlDocument(xmlText);
  let pointElements = [];

  for (const pointTag of ["wpt", "rtept", "trkpt"]) {
    pointElements = findElementsByLocalName(documentNode, pointTag);

    if (pointElements.length > 0) {
      break;
    }
  }

  return pointElements.map((element, index) => {
    const pointNumber = index + 1;
    const latText = element.getAttribute("lat");
    const lonText = element.getAttribute("lon");

    if (latText === null || lonText === null) {
      throw new Error(`GPX point ${pointNumber} is missing lat/lon.`);
    }

    return {
      id: pointNumber,
      name: normalizeName(findFirstChildTextByLocalName(element, "name"), pointNumber, trimName),
      lat: parseCoordinate(latText, pointNumber, "latitude"),
      lon: parseCoordinate(lonText, pointNumber, "longitude"),
    };
  });
}

export function parseSourceText(text, fileName, trimName = null) {
  const normalizedName = (fileName || "").toLowerCase();
  const trimmed = text.trimStart();

  if (normalizedName.endsWith(".gpx")) {
    return parseGpxText(text, trimName);
  }

  if (normalizedName.endsWith(".txt")) {
    return parsePointsText(text, trimName);
  }

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<gpx") || trimmed.includes("<gpx")) {
    return parseGpxText(text, trimName);
  }

  return parsePointsText(text, trimName);
}

function encodeName(name, lineno) {
  const raw = textEncoder.encode(name);
  const length = raw.length + 1;

  if (length > 255) {
    throw new Error(
      `Line ${lineno}: encoded name is too long for one-byte length field (${raw.length} bytes).`
    );
  }

  const data = new Uint8Array(raw.length + 3);
  data[0] = 0;
  data[1] = length;
  data.set(raw, 2);
  data[data.length - 1] = 0;
  return data;
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

export function buildNamesData(points) {
  return concatChunks(points.map((point, index) => encodeName(point.name, index + 1)));
}

function encodeCoord(value, lineno, fieldName) {
  const scaled = roundHalfEven(value * COORD_SCALE);

  if (!Number.isFinite(scaled) || scaled < -(2 ** 31) || scaled >= 2 ** 31) {
    throw new Error(`Line ${lineno}: ${fieldName}=${value} is out of range after scaling.`);
  }

  return scaled;
}

export function buildLocationData(points) {
  const pointCount = points.length;

  if (pointCount > MAX_POINT_COUNT) {
    throw new Error(
      `Too many points: got ${pointCount}, but the device supports at most ${MAX_POINT_COUNT}.`
    );
  }

  const buffer = new ArrayBuffer(MIN_SLOT_COUNT * 12 + TAIL_BYTES);
  const view = new DataView(buffer);
  const slotIds = pointCount === 0 ? [] : [pointCount, ...Array.from({ length: pointCount - 1 }, (_, index) => index + 1)];
  let offset = 0;

  slotIds.forEach((slotId, index) => {
    const point = points[index];
    view.setUint32(offset, slotId, true);
    view.setInt32(offset + 4, encodeCoord(point.lat, index + 1, "lat"), true);
    view.setInt32(offset + 8, encodeCoord(point.lon, index + 1, "lon"), true);
    offset += 12;
  });

  let tailSlots = MIN_SLOT_COUNT - pointCount;

  if (pointCount > 0 && tailSlots > 0) {
    view.setUint32(offset, pointCount, true);
    offset += 12;
    tailSlots -= 1;
  }

  offset += tailSlots * 12;

  if (pointCount === MAX_POINT_COUNT) {
    view.setUint32(MIN_SLOT_COUNT * 12, pointCount, true);
  }

  return new Uint8Array(buffer);
}

function asUint8Array(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }

  return new Uint8Array(bytes);
}

export function readLocations(bytes) {
  const source = asUint8Array(bytes);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const locations = [];
  const fullRecordCount = Math.floor(source.byteLength / 12);

  for (let index = 0; index < fullRecordCount; index += 1) {
    const offset = index * 12;
    const id = view.getUint32(offset, true);
    const lat = view.getInt32(offset + 4, true) / COORD_SCALE;
    const lon = view.getInt32(offset + 8, true) / COORD_SCALE;

    if (lat === 0 && lon === 0) {
      continue;
    }

    locations.push({ id, lat, lon });
  }

  return locations;
}

export function readNames(bytes) {
  const source = asUint8Array(bytes);
  const names = [];
  let index = 0;

  while (index < source.length) {
    while (index < source.length && source[index] === 0) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    const length = source[index];
    index += 1;

    if (length === 0) {
      continue;
    }

    const raw = source.slice(index, index + length - 1);
    index += length - 1;
    names.push(textDecoder.decode(raw));
  }

  return names;
}

export function combineLocationsAndNames(locations, names = []) {
  return locations.map((location, index) => ({
    ...location,
    name: index < names.length ? names[index] : "UNKNOWN",
  }));
}

export function buildPointsText(points) {
  if (points.length === 0) {
    return "";
  }

  return `${points
    .map((point) => `${point.name};${point.lat.toFixed(7)};${point.lon.toFixed(7)};`)
    .join("\n")}\n`;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGpxText(points) {
  const waypointLines = points.map((point) => [
    `  <wpt lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}">`,
    `    <name>${escapeXml(point.name)}</name>`,
    "  </wpt>",
  ].join("\n"));

  const body = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<gpx",
    "  version=\"1.1\"",
    "  creator=\"Points Tools\"",
    "  xmlns=\"http://www.topografix.com/GPX/1/1\"",
    "  xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
    "  xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\"",
    ">",
    "  <metadata>",
    "    <name>Location Points Export</name>",
    "  </metadata>",
    ...waypointLines,
    "</gpx>",
  ];

  return `${body.join("\n")}\n`;
}
