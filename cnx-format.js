export const CNX_MIME_TYPE = "application/xml;charset=utf-8";
export const POI_TYPES = [
  { code: "0", name: "Waypoint" },
  { code: "1", name: "Sprint Point" },
  { code: "2", name: "HC Climb" },
  { code: "3", name: "Level 1 Climb" },
  { code: "4", name: "Level 2 Climb" },
  { code: "5", name: "Level 3 Climb" },
  { code: "6", name: "Level 4 Climb" },
  { code: "7", name: "Supply Point" },
  { code: "8", name: "Garbage recycle area" },
  { code: "9", name: "Restroom" },
  { code: "10", name: "Service Point" },
  { code: "11", name: "Medical Aid Station" },
  { code: "12", name: "Equipment Area" },
  { code: "13", name: "Shop" },
  { code: "14", name: "Meeting Point" },
  { code: "15", name: "Viewing Platform" },
  { code: "16", name: "Instagram-Worthy Location" },
  { code: "17", name: "Tunnel" },
  { code: "18", name: "Valley" },
  { code: "19", name: "Dangerous Road" },
  { code: "20", name: "Sharp Turn" },
  { code: "21", name: "Steep Slope" },
  { code: "22", name: "Intersection" },
];

const EARTH_RADIUS_METERS = 6371 * 1000;

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

function findFirstChildByLocalName(element, tagName) {
  for (const child of Array.from(element.children)) {
    if (localName(child) === tagName) {
      return child;
    }
  }

  return null;
}

function findChildElementsByLocalName(element, tagName) {
  return Array.from(element.children).filter((child) => localName(child) === tagName);
}

function findFirstChildTextByLocalName(element, tagName) {
  const child = findFirstChildByLocalName(element, tagName);
  return child ? child.textContent : null;
}

function ensureXmlDocument(xmlText, invalidMessage = "Invalid XML file.") {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available in this browser.");
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(xmlText).replace(/^\ufeff/, ""), "application/xml");
  const rootElement = documentNode.documentElement;
  const parseErrors = findElementsByLocalName(documentNode, "parsererror");

  if ((rootElement && localName(rootElement) === "parsererror") || parseErrors.length > 0) {
    throw new Error(invalidMessage);
  }

  return documentNode;
}

function parseCoordinate(text, pointNumber, fieldName) {
  const value = Number.parseFloat(text);

  if (!Number.isFinite(value)) {
    throw new Error(`Point ${pointNumber}: ${fieldName} must be a number, got ${JSON.stringify(text)}.`);
  }

  return value;
}

function normalizePointName(name) {
  return name == null ? "" : String(name);
}

function normalizePointType(typeCode) {
  const normalized = String(typeCode ?? "").trim();
  return normalized || "0";
}

function formatCoordinate(value, fallbackText = null) {
  if (fallbackText !== null && fallbackText !== undefined && String(fallbackText).trim() !== "") {
    return String(fallbackText).trim();
  }

  return Number(value).toFixed(7);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function roundHalfUp(value, digits = 0) {
  const factor = 10 ** digits;
  const absolute = Math.abs(value) * factor;
  const rounded = Math.floor(absolute + 0.5) / factor;

  if (rounded === 0 && Object.is(value, -0)) {
    return -0;
  }

  if (rounded === 0) {
    return 0;
  }

  return value < 0 ? -rounded : rounded;
}

function formatFixedHalfUp(value, digits) {
  const rounded = roundHalfUp(value, digits);

  if (Object.is(rounded, -0)) {
    return `-${(0).toFixed(digits)}`;
  }

  return rounded.toFixed(digits);
}

function stripTrailingZeros(text) {
  return String(text).replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "").replace(/\.$/u, "");
}

function formatTrackCoordinateText(value, fallbackText = null) {
  if (fallbackText !== null && fallbackText !== undefined && String(fallbackText).trim() !== "") {
    return String(fallbackText).trim();
  }

  return stripTrailingZeros(Number(value).toFixed(7));
}

function powerOfTen(exponent) {
  return 10n ** BigInt(exponent);
}

function parseExactDecimal(text) {
  const raw = String(text ?? "").trim();

  if (raw === "") {
    return { value: 0n, scale: 0 };
  }

  const sign = raw.startsWith("-") ? -1n : 1n;
  const unsigned = raw.replace(/^[+-]/u, "");
  const [integerPartRaw, fractionPartRaw = ""] = unsigned.split(".");
  const integerPart = integerPartRaw === "" ? "0" : integerPartRaw;
  const digitsText = `${integerPart}${fractionPartRaw}`.replace(/^0+(?=\d)/u, "");

  return {
    value: sign * BigInt(digitsText === "" ? "0" : digitsText),
    scale: fractionPartRaw.length,
  };
}

function subtractExactDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.value * powerOfTen(scale - left.scale);
  const rightValue = right.value * powerOfTen(scale - right.scale);

  return {
    value: leftValue - rightValue,
    scale,
  };
}

function multiplyExactDecimalByPowerOfTen(decimalValue, exponent) {
  if (decimalValue.scale >= exponent) {
    return {
      value: decimalValue.value,
      scale: decimalValue.scale - exponent,
    };
  }

  return {
    value: decimalValue.value * powerOfTen(exponent - decimalValue.scale),
    scale: 0,
  };
}

function exactScaledDifference(currentText, previousText, exponent) {
  return multiplyExactDecimalByPowerOfTen(
    subtractExactDecimal(parseExactDecimal(currentText), parseExactDecimal(previousText)),
    exponent
  );
}

function roundExactDecimalToIntegerString(decimalValue) {
  const sign = decimalValue.value < 0n ? -1n : 1n;
  const absoluteValue = decimalValue.value < 0n ? -decimalValue.value : decimalValue.value;

  if (absoluteValue === 0n) {
    return "0";
  }

  if (decimalValue.scale === 0) {
    return decimalValue.value.toString();
  }

  const divisor = powerOfTen(decimalValue.scale);
  const quotient = absoluteValue / divisor;
  const remainder = absoluteValue % divisor;
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n);

  if (rounded === 0n) {
    return sign < 0n ? "-0" : "0";
  }

  return sign < 0n ? `-${rounded}` : rounded.toString();
}

function normalizePoints(points) {
  return points.map((point, index) => {
    const pointNumber = index + 1;
    return {
      ...point,
      id: point.id ?? pointNumber,
      name: normalizePointName(point.name),
      type: normalizePointType(point.type),
      latText: formatCoordinate(point.lat, point.latText),
      lonText: formatCoordinate(point.lon, point.lonText),
    };
  });
}

function calc3dDistanceMeters(previousPoint, currentPoint) {
  const dlat = (currentPoint.lat - previousPoint.lat) * (Math.PI / 180);
  const dlon = (currentPoint.lon - previousPoint.lon) * (Math.PI / 180);
  const dele = currentPoint.ele - previousPoint.ele;
  const a = (
    Math.sin(dlat / 2) * Math.sin(dlat / 2) +
    Math.cos(previousPoint.lat * (Math.PI / 180)) *
    Math.cos(currentPoint.lat * (Math.PI / 180)) *
    Math.sin(dlon / 2) * Math.sin(dlon / 2)
  );
  const b = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const horizontalDistance = EARTH_RADIUS_METERS * b;

  return Math.sqrt(horizontalDistance ** 2 + dele ** 2);
}

function buildTracksText(trackPoints) {
  if (trackPoints.length === 0) {
    return "";
  }

  const relativePoints = [
    [
      formatTrackCoordinateText(trackPoints[0].lat, trackPoints[0].latText),
      formatTrackCoordinateText(trackPoints[0].lon, trackPoints[0].lonText),
      roundExactDecimalToIntegerString(
        multiplyExactDecimalByPowerOfTen(
          parseExactDecimal(trackPoints[0].eleText ?? String(trackPoints[0].ele ?? 0)),
          2
        )
      ),
    ].join(","),
  ];
  const firstDiffs = [];

  for (let index = 1; index < trackPoints.length; index += 1) {
    const previousPoint = trackPoints[index - 1];
    const currentPoint = trackPoints[index];
    const latDiff = exactScaledDifference(currentPoint.latText, previousPoint.latText, 7);
    const lonDiff = exactScaledDifference(currentPoint.lonText, previousPoint.lonText, 7);
    const eleDiff = exactScaledDifference(
      currentPoint.eleText ?? String(currentPoint.ele ?? 0),
      previousPoint.eleText ?? String(previousPoint.ele ?? 0),
      2
    );

    firstDiffs.push({ latDiff, lonDiff, eleDiff });

    if (index === 1) {
      relativePoints.push([
        roundExactDecimalToIntegerString(latDiff),
        roundExactDecimalToIntegerString(lonDiff),
        roundExactDecimalToIntegerString(eleDiff),
      ].join(","));
    }
  }

  for (let index = 1; index < firstDiffs.length; index += 1) {
    relativePoints.push([
      roundExactDecimalToIntegerString(
        subtractExactDecimal(firstDiffs[index].latDiff, firstDiffs[index - 1].latDiff)
      ),
      roundExactDecimalToIntegerString(
        subtractExactDecimal(firstDiffs[index].lonDiff, firstDiffs[index - 1].lonDiff)
      ),
      roundExactDecimalToIntegerString(firstDiffs[index].eleDiff),
    ].join(","));
  }

  return `${relativePoints.join(";")};`;
}

function calculateRouteMetrics(trackPoints) {
  let distance = 0;
  let ascent = 0;
  let descent = 0;

  for (let index = 1; index < trackPoints.length; index += 1) {
    const previousPoint = trackPoints[index - 1];
    const currentPoint = trackPoints[index];
    const elevationDiff = currentPoint.ele - previousPoint.ele;

    distance = roundHalfUp(distance + calc3dDistanceMeters(previousPoint, currentPoint), 2);

    if (elevationDiff > 0) {
      ascent = roundHalfUp(ascent + elevationDiff, 2);
    } else {
      descent = roundHalfUp(descent + elevationDiff, 2);
    }
  }

  return {
    distanceText: formatFixedHalfUp(distance, 2),
    ascentText: formatFixedHalfUp(ascent, 2),
    descentText: formatFixedHalfUp(descent, 2),
    tracksCount: trackPoints.length,
    tracksText: buildTracksText(trackPoints),
  };
}

function buildRouteMetadata(trackPoints, routeId = "Route") {
  return {
    routeId: routeId == null ? "Route" : String(routeId),
    ...calculateRouteMetrics(trackPoints),
  };
}

function collectTrackPointsForCnx(documentNode, fileName = "") {
  const rootElement = documentNode.documentElement;
  const trackElements = rootElement ? findChildElementsByLocalName(rootElement, "trk") : [];
  const firstTrackElement = trackElements[0] ?? null;
  const routeId = String(
    (firstTrackElement
      ? (findFirstChildTextByLocalName(firstTrackElement, "name") ?? "Unknown")
      : null) ??
    String(fileName).replace(/\.[^.]+$/u, "") ??
    "Route"
  ) || "Route";
  const trackPoints = [];
  let sourceSegmentsCount = 0;

  trackElements.forEach((trackElement) => {
    const trackSegmentElements = findChildElementsByLocalName(trackElement, "trkseg");

    trackSegmentElements.forEach((trackSegmentElement) => {
      sourceSegmentsCount += 1;

      findChildElementsByLocalName(trackSegmentElement, "trkpt").forEach((trackPointElement) => {
        const pointNumber = trackPoints.length + 1;
        const latText = trackPointElement.getAttribute("lat");
        const lonText = trackPointElement.getAttribute("lon");
        const eleText = String(findFirstChildTextByLocalName(trackPointElement, "ele") ?? "0").trim();

        if (latText === null || lonText === null) {
          throw new Error(`Track point ${pointNumber} is missing lat/lon.`);
        }

        trackPoints.push({
          lat: parseCoordinate(latText, pointNumber, "latitude"),
          lon: parseCoordinate(lonText, pointNumber, "longitude"),
          ele: parseCoordinate(eleText, pointNumber, "elevation"),
          latText: String(latText).trim(),
          lonText: String(lonText).trim(),
          eleText,
        });
      });
    });
  });

  return {
    routeId,
    sourceTracksCount: trackElements.length,
    sourceSegmentsCount,
    trackPoints,
  };
}

function buildPointElement(documentNode, point) {
  const pointElement = documentNode.createElement("Point");
  const latElement = documentNode.createElement("Lat");
  const lngElement = documentNode.createElement("Lng");
  const typeElement = documentNode.createElement("Type");
  const descrElement = documentNode.createElement("Descr");

  latElement.textContent = point.latText;
  lngElement.textContent = point.lonText;
  typeElement.textContent = point.type;
  descrElement.textContent = point.name;

  pointElement.append(latElement, lngElement, typeElement, descrElement);
  return pointElement;
}

function serializeRoute(routeElement) {
  if (typeof XMLSerializer === "undefined") {
    throw new Error("XMLSerializer is not available in this browser.");
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${new XMLSerializer().serializeToString(routeElement)}\n`;
}

export function parseCnxText(xmlText) {
  const documentNode = ensureXmlDocument(xmlText, "Invalid CNX/XML file.");
  const routeElement = documentNode.documentElement;

  if (!routeElement || localName(routeElement) !== "Route") {
    throw new Error("CNX file must contain a <Route> root element.");
  }

  const pointsElement = findFirstChildByLocalName(routeElement, "Points");

  if (!pointsElement) {
    throw new Error("CNX file does not contain a <Points> section.");
  }

  const pointElements = Array.from(pointsElement.children).filter((element) => localName(element) === "Point");
  const points = pointElements.map((pointElement, index) => {
    const pointNumber = index + 1;
    const latText = findFirstChildTextByLocalName(pointElement, "Lat");
    const lonText = findFirstChildTextByLocalName(pointElement, "Lng");

    if (latText === null || lonText === null) {
      throw new Error(`Point ${pointNumber} is missing <Lat> or <Lng>.`);
    }

    return {
      id: pointNumber,
      name: normalizePointName(findFirstChildTextByLocalName(pointElement, "Descr")),
      type: normalizePointType(findFirstChildTextByLocalName(pointElement, "Type")),
      lat: parseCoordinate(latText, pointNumber, "latitude"),
      lon: parseCoordinate(lonText, pointNumber, "longitude"),
      latText: String(latText).trim(),
      lonText: String(lonText).trim(),
    };
  });

  return {
    documentNode,
    routeId: String(findFirstChildTextByLocalName(routeElement, "Id") ?? "").trim() || "Route",
    points,
  };
}

export function parseGpxForCnxText(xmlText, fileName = "") {
  const documentNode = ensureXmlDocument(xmlText, "Invalid GPX/XML file.");
  const rootElement = documentNode.documentElement;
  const waypointElements = rootElement ? findChildElementsByLocalName(rootElement, "wpt") : [];
  const points = waypointElements.map((waypointElement, index) => {
    const pointNumber = index + 1;
    const latText = waypointElement.getAttribute("lat");
    const lonText = waypointElement.getAttribute("lon");

    if (latText === null || lonText === null) {
      throw new Error(`Waypoint ${pointNumber} is missing lat/lon.`);
    }

    return {
      id: pointNumber,
      name: normalizePointName(findFirstChildTextByLocalName(waypointElement, "name")),
      type: "0",
      lat: parseCoordinate(latText, pointNumber, "latitude"),
      lon: parseCoordinate(lonText, pointNumber, "longitude"),
      latText: String(latText).trim(),
      lonText: String(lonText).trim(),
    };
  });
  const { routeId, trackPoints, sourceTracksCount, sourceSegmentsCount } = collectTrackPointsForCnx(documentNode, fileName);

  return {
    points,
    route: {
      ...buildRouteMetadata(trackPoints, routeId),
      sourceTracksCount,
      sourceSegmentsCount,
    },
  };
}

export function buildRouteCnxText(route, points) {
  const normalizedPoints = normalizePoints(points);
  const normalizedRoute = {
    routeId: String(route?.routeId ?? "Route").trim() || "Route",
    distanceText: String(route?.distanceText ?? "0.00"),
    ascentText: String(route?.ascentText ?? "0.00"),
    descentText: String(route?.descentText ?? "0.00"),
    tracksCount: Number.isInteger(route?.tracksCount) ? route.tracksCount : 0,
    tracksText: String(route?.tracksText ?? ""),
  };
  const pointLines = normalizedPoints.flatMap((point) => ([
    "    <Point>",
    `      <Lat>${escapeXml(point.latText)}</Lat>`,
    `      <Lng>${escapeXml(point.lonText)}</Lng>`,
    `      <Type>${escapeXml(point.type)}</Type>`,
    point.name === ""
      ? "      <Descr/>"
      : `      <Descr>${escapeXml(point.name)}</Descr>`,
    "    </Point>",
  ]));
  const body = [
    "<Route>",
    `  <Id>${escapeXml(normalizedRoute.routeId)}</Id>`,
    `  <Distance>${escapeXml(normalizedRoute.distanceText)}</Distance>`,
    "  <Duration>",
    "  </Duration>",
    `  <Ascent>${escapeXml(normalizedRoute.ascentText)}</Ascent>`,
    `  <Descent>${escapeXml(normalizedRoute.descentText)}</Descent>`,
    "  <Encode>2</Encode>",
    "  <Lang>0</Lang>",
    `  <TracksCount>${normalizedRoute.tracksCount}</TracksCount>`,
    normalizedRoute.tracksText
      ? `  <Tracks>${escapeXml(normalizedRoute.tracksText)}</Tracks>`
      : "  <Tracks />",
    "  <Navs />",
    `  <PointsCount>${normalizedPoints.length}</PointsCount>`,
    "  <Points>",
    ...pointLines,
    "  </Points>",
    "</Route>",
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body.join("\n")}\n`;
}

export function buildEditedCnxText(documentNode, points, routeId = null) {
  const clone = documentNode.cloneNode(true);
  const routeElement = clone.documentElement;
  const normalizedPoints = normalizePoints(points);
  let pointsElement = findFirstChildByLocalName(routeElement, "Points");
  let pointsCountElement = findFirstChildByLocalName(routeElement, "PointsCount");

  if (!pointsElement) {
    pointsElement = clone.createElement("Points");
    routeElement.append(pointsElement);
  }

  if (!pointsCountElement) {
    pointsCountElement = clone.createElement("PointsCount");
    routeElement.append(pointsCountElement);
  }

  if (routeId !== null) {
    let idElement = findFirstChildByLocalName(routeElement, "Id");

    if (!idElement) {
      idElement = clone.createElement("Id");
      routeElement.insertBefore(idElement, routeElement.firstChild);
    }

    idElement.textContent = String(routeId).trim() || "Route";
  }

  pointsCountElement.textContent = String(normalizedPoints.length);

  while (pointsElement.firstChild) {
    pointsElement.removeChild(pointsElement.firstChild);
  }

  if (normalizedPoints.length > 0) {
    pointsElement.append(clone.createTextNode("\n"));

    normalizedPoints.forEach((point) => {
      pointsElement.append(clone.createTextNode("    "));
      pointsElement.append(buildPointElement(clone, point));
      pointsElement.append(clone.createTextNode("\n"));
    });

    pointsElement.append(clone.createTextNode("  "));
  }

  return serializeRoute(routeElement);
}
