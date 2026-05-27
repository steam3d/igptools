# iGPTOOLS

A set of utilities for working with waypoints and routes on `iGPSPORT BiNavi` and `BiNavi Air` devices.

## Features

- Convert `GPX` waypoints into `location.dat` and `point_name_list.dat`
- Convert `location.dat` and `point_name_list.dat` back into `GPX`
- Convert `GPX` routes into `CNX` format
- Clean `GPX` files by keeping only POI, route geometry, and elevation data
- Edit waypoints and POI types inside `CNX` files

## Supported Devices

- `iGPSPORT BiNavi`
- `iGPSPORT BiNavi Air`

## Web Interface

Open the website and choose the required tool:

https://steam3d.github.io/igptools/

## Important

Before replacing files on the device, it is recommended to create a backup of the `location.dat` and `point_name_list.dat` files from the `iGPSPORT/System` folder.

## Location Points Format

Location points data is stored in two files:
- `location.dat`
- `point_name_list.dat`

### `location.dat`

Format details:

- fixed file size — `244` bytes;
- `20` slots of `12` bytes each + `4` trailing bytes;
- each record is stored as a little-endian `<Iii>` structure:
  - `id` — `uint32`
  - `lat` — `int32`
  - `lon` — `int32`
- coordinates are stored as degrees multiplied by `10_000_000`;
- the device supports up to `20` waypoints.

A device-compatible layout is used when writing the file:

- for `N` waypoints, identifiers are written in the order `N, 1, 2, ..., N-1`;
- if free slots are still available, an empty slot with `id = N` is added after the real waypoints;
- remaining slots are filled with zeros;
- if all `20` slots are occupied, the final `4` bytes contain the little-endian value `20`.

### `point_name_list.dat`

Names are stored sequentially in UTF-8. Each record has the following format:

- leading byte `00`;
- length byte;
- name bytes;
- trailing byte `00`.

Important: names are matched to coordinates by file position, not by `id`.

## CNX Converter

Implementation based on:
https://github.com/LudvvigB/GPXtoCNXConverter
https://github.com/sidkurt/GPXtoCNXConverter

The original logic was adapted and rewritten in JavaScript.
During GPX to CNX conversion, all `trk` and `trkseg` sections are merged into a single
CNX track, matching the behavior of the newer Python implementation.

## Additional

### Yandex Maps → GPX

The following project is used for exporting routes from Yandex Maps:
https://github.com/ag79/yandex-maps-gpx
