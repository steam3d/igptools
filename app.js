import {
  GPX_FILE,
  LOCATION_FILE,
  NAMES_FILE,
  buildGpxText,
  buildLocationData,
  buildNamesData,
  combineLocationsAndNames,
  parseGpxText,
  readLocations,
  readNames,
} from "./lp-format.js";
import {
  CNX_MIME_TYPE,
  buildRouteCnxText,
  POI_TYPES,
  buildEditedCnxText,
  parseGpxForCnxText,
  parseCnxText,
} from "./cnx-format.js";
import {
  CLEANED_GPX_FILE,
  CLEANED_GPX_MIME_TYPE,
  buildCleanedGpxDownloadName,
  cleanGpxText,
} from "./gpx-cleaner.js";

const modeTabs = Array.from(document.querySelectorAll(".mode-tab[data-mode-target]"));
const modePanels = {
  convert: document.querySelector("#mode-convert"),
  read: document.querySelector("#mode-read"),
  "gpx-cnx": document.querySelector("#mode-gpx-cnx"),
  "gpx-cleaner": document.querySelector("#mode-gpx-cleaner"),
  "cnx-edit": document.querySelector("#mode-cnx-edit"),
  "update-maps": document.querySelector("#mode-update-maps"),
};

const convertForm = document.querySelector("#convert-form");
const readForm = document.querySelector("#read-form");
const gpxCnxForm = document.querySelector("#gpx-cnx-form");
const gpxCleanerForm = document.querySelector("#gpx-cleaner-form");
const cnxEditForm = document.querySelector("#cnx-edit-form");

const convertStatus = document.querySelector("#convert-status");
const readStatus = document.querySelector("#read-status");
const gpxCnxStatus = document.querySelector("#gpx-cnx-status");
const gpxCleanerStatus = document.querySelector("#gpx-cleaner-status");
const cnxEditStatus = document.querySelector("#cnx-edit-status");

const convertResult = document.querySelector("#convert-result");
const readResult = document.querySelector("#read-result");
const gpxCnxResult = document.querySelector("#gpx-cnx-result");
const cnxEditResult = document.querySelector("#cnx-edit-result");

const convertTableBody = document.querySelector("#convert-table-body");
const readTableBody = document.querySelector("#read-table-body");
const gpxCnxTableBody = document.querySelector("#gpx-cnx-table-body");
const cnxEditTableBody = document.querySelector("#cnx-edit-table-body");

const downloadLocationButton = document.querySelector("#download-location");
const downloadNamesButton = document.querySelector("#download-names");
const downloadGpxButton = document.querySelector("#download-gpx");
const downloadGpxCnxButton = document.querySelector("#download-gpx-cnx");
const downloadCnxEditButton = document.querySelector("#download-cnx-edit");

const downloadLocationLink = document.querySelector("#download-location-link");
const downloadNamesLink = document.querySelector("#download-names-link");
const downloadGpxLink = document.querySelector("#download-gpx-link");
const downloadGpxCnxLink = document.querySelector("#download-gpx-cnx-link");
const downloadGpxCleanerLink = document.querySelector("#download-gpx-cleaner-link");
const downloadCnxEditLink = document.querySelector("#download-cnx-edit-link");

const objectUrls = new Map();
const editors = {
  gpxCnx: null,
  cnxEdit: null,
};

function revokeObjectUrl(key) {
  const current = objectUrls.get(key);

  if (current) {
    URL.revokeObjectURL(current);
    objectUrls.delete(key);
  }
}

function setDownload(link, key, data, fileName, mimeType) {
  revokeObjectUrl(key);
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  link.href = url;
  link.download = fileName;
}

function bindDownloadButton(button, link) {
  button.addEventListener("click", () => {
    if (link.href) {
      link.click();
    }
  });
}

function setStatus(element, message, kind = "info") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function clearStatus(element) {
  element.textContent = "";
  delete element.dataset.kind;
}

function formatCoordinate(value) {
  return value.toFixed(7);
}

function renderTable(tbody, points) {
  tbody.textContent = "";

  points.forEach((point) => {
    const row = document.createElement("tr");
    const idCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const latCell = document.createElement("td");
    const lonCell = document.createElement("td");

    idCell.textContent = String(point.id);
    nameCell.textContent = point.name;
    latCell.textContent = formatCoordinate(point.lat);
    lonCell.textContent = formatCoordinate(point.lon);

    row.append(idCell, nameCell, latCell, lonCell);
    tbody.append(row);
  });
}

function renderEditablePoiTable(tbody, points, onChange) {
  tbody.textContent = "";

  points.forEach((point) => {
    const row = document.createElement("tr");
    const idCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const typeCell = document.createElement("td");
    const latCell = document.createElement("td");
    const lonCell = document.createElement("td");
    const nameInput = document.createElement("input");
    const typeSelect = document.createElement("select");

    idCell.textContent = String(point.id);

    nameInput.type = "text";
    nameInput.value = point.name;
    nameInput.setAttribute("aria-label", `Point ${point.id} name`);
    nameInput.addEventListener("input", () => {
      point.name = nameInput.value;
      onChange();
    });

    if (!POI_TYPES.some((type) => type.code === point.type)) {
      const unknownOption = document.createElement("option");
      unknownOption.value = point.type;
      unknownOption.textContent = `Unknown type (${point.type})`;
      typeSelect.append(unknownOption);
    }

    POI_TYPES.forEach((type) => {
      const option = document.createElement("option");
      option.value = type.code;
      option.textContent = type.name;
      typeSelect.append(option);
    });

    typeSelect.value = point.type;
    typeSelect.setAttribute("aria-label", `Point ${point.id} type`);
    typeSelect.addEventListener("change", () => {
      point.type = typeSelect.value;
      onChange();
    });

    latCell.textContent = formatCoordinate(point.lat);
    lonCell.textContent = formatCoordinate(point.lon);

    nameCell.append(nameInput);
    typeCell.append(typeSelect);
    row.append(idCell, nameCell, typeCell, latCell, lonCell);
    tbody.append(row);
  });
}

function activateMode(modeName) {
  modeTabs.forEach((tab) => {
    const active = tab.dataset.modeTarget === modeName;
    tab.setAttribute("aria-selected", String(active));
  });

  Object.entries(modePanels).forEach(([name, panel]) => {
    panel.hidden = name !== modeName;
  });
}

function trailingBytesLabel(byteLength) {
  return byteLength % 12;
}

function stripExtension(fileName) {
  return String(fileName).replace(/\.[^.]+$/, "");
}

function buildRouteDownloadName(sourceFileName) {
  const baseName = stripExtension(sourceFileName).trim() || "points";
  return `route_${baseName.slice(0, 18)}.cnx`;
}

function buildEditedDownloadName(sourceFileName) {
  const normalized = String(sourceFileName).trim();

  if (normalized.toLowerCase().endsWith(".cnx")) {
    return normalized;
  }

  const baseName = stripExtension(normalized) || "edited_route";
  return `${baseName}.cnx`;
}

function refreshGpxCnxDownload() {
  if (!editors.gpxCnx) {
    return;
  }

  const cnxText = buildRouteCnxText(editors.gpxCnx.route, editors.gpxCnx.points);
  setDownload(
    downloadGpxCnxLink,
    "download-gpx-cnx",
    cnxText,
    editors.gpxCnx.downloadName,
    CNX_MIME_TYPE
  );
  downloadGpxCnxButton.disabled = false;
}

function refreshCnxEditDownload() {
  if (!editors.cnxEdit) {
    return;
  }

  const cnxText = buildEditedCnxText(
    editors.cnxEdit.documentNode,
    editors.cnxEdit.points,
    editors.cnxEdit.routeId
  );
  setDownload(
    downloadCnxEditLink,
    "download-cnx-edit",
    cnxText,
    editors.cnxEdit.downloadName,
    CNX_MIME_TYPE
  );
  downloadCnxEditButton.disabled = false;
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activateMode(tab.dataset.modeTarget);
  });
});

[
  [downloadLocationButton, downloadLocationLink],
  [downloadNamesButton, downloadNamesLink],
  [downloadGpxButton, downloadGpxLink],
  [downloadGpxCnxButton, downloadGpxCnxLink],
  [downloadCnxEditButton, downloadCnxEditLink],
].forEach(([button, link]) => bindDownloadButton(button, link));

convertForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus(convertStatus);
  convertResult.hidden = true;

  try {
    const sourceFile = convertForm.elements["source-file"].files[0];

    if (!sourceFile) {
      throw new Error("Choose a GPX file first.");
    }

    const trimField = convertForm.elements["trim-name"];
    const trimName = trimField.value === "" ? null : Number.parseInt(trimField.value, 10);

    if (trimName !== null && (!Number.isInteger(trimName) || trimName < 0)) {
      throw new Error("Trim length must be a non-negative integer.");
    }

    const sourceText = await sourceFile.text();
    const points = parseGpxText(sourceText, trimName);
    const locationData = buildLocationData(points);
    const namesData = buildNamesData(points);

    setDownload(downloadLocationLink, "download-location", locationData, LOCATION_FILE, "application/octet-stream");
    setDownload(downloadNamesLink, "download-names", namesData, NAMES_FILE, "application/octet-stream");
    downloadLocationButton.disabled = false;
    downloadNamesButton.disabled = false;

    renderTable(convertTableBody, points);
    console.info(
      `Loaded ${points.length} waypoint(s) from ${sourceFile.name}. Generated ` +
      `${LOCATION_FILE} (${locationData.byteLength} bytes) and ${NAMES_FILE} ` +
      `(${namesData.byteLength} bytes).`
    );
    convertResult.hidden = false;
  } catch (error) {
    setStatus(convertStatus, error instanceof Error ? error.message : String(error), "error");
  }
});

readForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus(readStatus);
  readResult.hidden = true;

  try {
    const locationFile = readForm.elements["location-file"].files[0];
    const namesFile = readForm.elements["names-file"].files[0];

    if (!locationFile) {
      throw new Error("Choose location.dat first.");
    }

    if (!namesFile) {
      throw new Error("Choose point_name_list.dat too.");
    }

    const locationData = new Uint8Array(await locationFile.arrayBuffer());
    const namesData = new Uint8Array(await namesFile.arrayBuffer());
    const locations = readLocations(locationData);
    const names = readNames(namesData);

    if (names.length < locations.length) {
      throw new Error("point_name_list.dat contains fewer names than location.dat points.");
    }

    const points = combineLocationsAndNames(locations, names);
    const gpxText = buildGpxText(points);

    setDownload(
      downloadGpxLink,
      "download-gpx",
      gpxText,
      GPX_FILE,
      "application/gpx+xml;charset=utf-8"
    );
    downloadGpxButton.disabled = false;

    renderTable(readTableBody, points);
    console.info(
      `Read ${points.length} point(s) from ${locationFile.name} (${locationData.byteLength} bytes, ` +
      `${trailingBytesLabel(locationData.byteLength)} trailing byte(s) after 12-byte records). ` +
      `Loaded ${names.length} name(s) from ${namesFile.name}. Generated ${GPX_FILE}.`
    );
    readResult.hidden = false;
  } catch (error) {
    setStatus(readStatus, error instanceof Error ? error.message : String(error), "error");
  }
});

gpxCnxForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus(gpxCnxStatus);
  gpxCnxResult.hidden = true;

  try {
    const sourceFile = gpxCnxForm.elements["gpx-cnx-file"].files[0];

    if (!sourceFile) {
      throw new Error("Choose a GPX file first.");
    }

    const sourceText = await sourceFile.text();
    const parsed = parseGpxForCnxText(sourceText, sourceFile.name);

    if (parsed.points.length === 0) {
      throw new Error("GPX file must contain at least one waypoint (<wpt>).");
    }

    editors.gpxCnx = {
      route: parsed.route,
      downloadName: buildRouteDownloadName(sourceFile.name),
      points: parsed.points,
    };

    renderEditablePoiTable(gpxCnxTableBody, editors.gpxCnx.points, refreshGpxCnxDownload);
    refreshGpxCnxDownload();
    console.info(
      `Loaded ${parsed.points.length} point(s) and ${parsed.route.tracksCount} track point(s) from ${sourceFile.name} for CNX export. ` +
      `Generated download ${editors.gpxCnx.downloadName}.`
    );
    gpxCnxResult.hidden = false;
    setStatus(gpxCnxStatus, "Points loaded. Edit names or types and download the CNX file.", "success");
  } catch (error) {
    setStatus(gpxCnxStatus, error instanceof Error ? error.message : String(error), "error");
  }
});

gpxCleanerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus(gpxCleanerStatus);

  try {
    const sourceFile = gpxCleanerForm.elements["gpx-cleaner-file"].files[0];

    if (!sourceFile) {
      throw new Error("Choose a GPX file first.");
    }

    const sourceText = await sourceFile.text();
    const cleaned = cleanGpxText(sourceText);
    const downloadName = sourceFile.name
      ? buildCleanedGpxDownloadName(sourceFile.name)
      : CLEANED_GPX_FILE;

    setDownload(
      downloadGpxCleanerLink,
      "download-gpx-cleaner",
      cleaned.gpxText,
      downloadName,
      CLEANED_GPX_MIME_TYPE
    );
    downloadGpxCleanerLink.click();

    console.info(
      "GPX cleaner summary:",
      {
        fileName: sourceFile.name,
        ...cleaned.summary,
      }
    );
  } catch (error) {
    setStatus(gpxCleanerStatus, error instanceof Error ? error.message : String(error), "error");
  }
});

cnxEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus(cnxEditStatus);
  cnxEditResult.hidden = true;

  try {
    const sourceFile = cnxEditForm.elements["cnx-edit-file"].files[0];

    if (!sourceFile) {
      throw new Error("Choose a CNX file first.");
    }

    const sourceText = await sourceFile.text();
    const parsed = parseCnxText(sourceText);

    editors.cnxEdit = {
      documentNode: parsed.documentNode,
      routeId: parsed.routeId,
      downloadName: buildEditedDownloadName(sourceFile.name),
      points: parsed.points,
    };

    renderEditablePoiTable(cnxEditTableBody, editors.cnxEdit.points, refreshCnxEditDownload);
    refreshCnxEditDownload();
    console.info(
      `Loaded ${parsed.points.length} CNX point(s) from ${sourceFile.name}. ` +
      `Generated download ${editors.cnxEdit.downloadName}.`
    );
    cnxEditResult.hidden = false;
    setStatus(cnxEditStatus, "Points loaded. Edit names or types and download the CNX file.", "success");
  } catch (error) {
    setStatus(cnxEditStatus, error instanceof Error ? error.message : String(error), "error");
  }
});

window.addEventListener("beforeunload", () => {
  Array.from(objectUrls.keys()).forEach((key) => revokeObjectUrl(key));
});

activateMode("convert");
