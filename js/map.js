const toLngLat = (loc) => [Number(loc.longitude), Number(loc.latitude)];

const toLatLng = (loc) => [Number(loc.latitude), Number(loc.longitude)];

const haversineMeters = (a, b) => {
    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 2 * R * Math.asin(Math.sqrt(h));
};

const buildDistanceIndex = (coords) => {
    const distances = [0];
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) {
        total += haversineMeters(coords[i - 1], coords[i]);
        distances.push(total);
    }
    return { distances, total };
};

const interpolateByDistance = (coords, distances, target) => {
    if (target <= 0) {
        return coords[0];
    }
    if (target >= distances[distances.length - 1]) {
        return coords[coords.length - 1];
    }
    let idx = distances.findIndex((value) => value >= target);
    if (idx <= 0) {
        return coords[0];
    }
    const prev = distances[idx - 1];
    const next = distances[idx];
    const ratio = (target - prev) / Math.max(1, next - prev);
    const a = coords[idx - 1];
    const b = coords[idx];
    return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
};

const escapeHtml = (text) => String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

class RouteService {
    constructor(config) {
        this.config = config;
        this.cache = new Map();
    }

    makeCacheKey(start, end) {
        const provider = String(this.config.routeProvider || "").toLowerCase();
        const part = (point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
        return `${provider}:${part(start)}->${part(end)}`;
    }

    async fetchRoute(startLngLat, endLngLat, options = {}) {
        const cacheKey = this.makeCacheKey(startLngLat, endLngLat);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached.slice();
        }

        const provider = String(this.config.routeProvider || "").toLowerCase();
        let route;
        const signal = options.signal;

        if (provider === "ors" || provider === "openrouteservice") {
            route = await this.fetchFromOpenRouteService(startLngLat, endLngLat, signal);
        } else {
            route = await this.fetchFromOSRM(startLngLat, endLngLat, signal);
        }

        if (route.length < 2) {
            throw new Error("Routing service returned an incomplete path.");
        }

        this.cache.set(cacheKey, route.slice());
        return route;
    }

    async fetchFromOSRM(startLngLat, endLngLat, signal) {
        const [startLng, startLat] = startLngLat;
        const [endLng, endLat] = endLngLat;
        const baseUrl = String(this.config.osrmBaseUrl || "").replace(/\/+$/, "");
        if (!baseUrl) {
            throw new Error("OSRM base URL is missing.");
        }
        const url = `${baseUrl}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

        const response = await fetch(url, { signal });
        if (!response.ok) {
            throw new Error(`OSRM request failed: ${response.status}`);
        }

        const data = await response.json();
        const coordinates = data?.routes?.[0]?.geometry?.coordinates;
        return Array.isArray(coordinates) ? coordinates : [];
    }

    async fetchFromOpenRouteService(startLngLat, endLngLat, signal) {
        const apiKey = (this.config.openRouteServiceApiKey || "").trim();
        if (!apiKey) {
            throw new Error("OpenRouteService API key is missing.");
        }

        const [startLng, startLat] = startLngLat;
        const [endLng, endLat] = endLngLat;
        const query = `start=${startLng},${startLat}&end=${endLng},${endLat}`;
        const url = `https://api.openrouteservice.org/v2/directions/driving-car?${query}`;

        const response = await fetch(url, {
            signal,
            headers: {
                Authorization: apiKey,
                Accept: "application/json, application/geo+json",
            },
        });

        if (!response.ok) {
            throw new Error(`OpenRouteService request failed: ${response.status}`);
        }

        const data = await response.json();
        const coordinates = data?.features?.[0]?.geometry?.coordinates;
        return Array.isArray(coordinates) ? coordinates : [];
    }
}

export const createMapController = (config, callbacks = {}) => {
    const map = L.map("tour-map", { zoomControl: true, preferCanvas: true })
        .setView(config.defaultCenter, config.defaultZoom);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }).addTo(map);

    const routeService = new RouteService(config);
    const markers = new Map();
    const markersByDay = new Map();
    let activeMarkerId = null;

    const defaultMarkerIcon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
    });

    const busIcon = config.busIconUrl
        ? L.icon({
            iconUrl: config.busIconUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        })
        : L.divIcon({
            className: "tour-bus-marker",
            html: `
                <div class="tour-bus-fallback-icon tour-bus-coach" aria-hidden="true">
                    <span class="bus-shell"></span>
                    <span class="bus-roof"></span>
                    <span class="bus-window-row"></span>
                    <span class="bus-front"></span>
                    <span class="bus-door"></span>
                    <span class="bus-wheel bus-wheel-front"></span>
                    <span class="bus-wheel bus-wheel-rear"></span>
                    <span class="bus-shadow"></span>
                </div>
            `,
            iconSize: [56, 36],
            iconAnchor: [28, 18],
        });

    const busMarker = L.marker(config.defaultCenter, {
        icon: busIcon,
        keyboard: false,
    }).addTo(map);

    const routeLine = L.polyline([], {
        color: config.routeLineColor,
        weight: config.routeLineWeight,
        opacity: 0.92,
        lineJoin: "round",
    }).addTo(map);

    const setRoute = (coords) => {
        const latLngs = coords.map((pair) => [pair[1], pair[0]]);
        routeLine.setLatLngs(latLngs);
    };

    const clearRoute = () => {
        routeLine.setLatLngs([]);
    };

    const setBusPosition = (lngLat) => {
        busMarker.setLatLng([lngLat[1], lngLat[0]]);
    };

    const flyToLocation = (location, zoom) => {
        map.flyTo(toLatLng(location), zoom ?? config.locationZoom, {
            duration: 0.9,
        });
    };

    const createPopupHtml = (day, location) => {
        const images = Array.isArray(location.image_urls) ? location.image_urls : [];
        const gallery = images.length
            ? `
                <div style="display:flex;gap:6px;overflow-x:auto;margin-top:10px;padding-bottom:2px;">
                    ${images
                        .map(
                                (url, index) =>
                                    `<button type="button" class="tour-popup-gallery-trigger" data-location-id="${escapeHtml(location.id)}" data-full-src="${escapeHtml(url)}" data-alt="${escapeHtml(location.title)} image ${index + 1}" style="display:block;flex:0 0 auto;padding:0;background:transparent;border:0;cursor:pointer;">
                                    <img src="${escapeHtml(url)}" alt="${escapeHtml(location.title)} image ${index + 1}" style="width:76px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #d1fae5;" />
                                </button>`
                        )
                        .join("")}
                </div>
            `
            : "";

        return `
            <div data-location-id="${escapeHtml(location.id)}" style="font-family: ui-sans-serif, system-ui; font-size: 12px; line-height: 1.4; color: #0f172a;">
                <strong style="font-size: 13px;">${escapeHtml(location.title)}</strong>
                <p style="margin-top: 6px; color: #475569;">${escapeHtml(location.description)}</p>
                <button type="button" class="tour-popup-learn-more" data-location-id="${escapeHtml(location.id)}">Learn more</button>
                ${gallery}
            </div>
        `;
    };

    const setActiveMarker = (locationId) => {
        if (activeMarkerId && markers.has(activeMarkerId)) {
            const prev = markers.get(activeMarkerId);
            if (prev.element) {
                prev.element.classList.remove("tour-marker-active");
            }
        }
        activeMarkerId = locationId;
        const entry = markers.get(locationId);
        if (entry?.element) {
            entry.element.classList.add("tour-marker-active");
        }
    };

    const setMarkers = (days) => {
        markers.clear();
        markersByDay.clear();

        for (const day of days) {
            const list = [];
            for (const location of day.locations) {
                const marker = L.marker(toLatLng(location), { icon: defaultMarkerIcon })
                    .bindPopup(createPopupHtml(day, location), { offset: [0, -6] })
                    .addTo(map);

                const element = marker.getElement();
                if (element) {
                    element.classList.add("tour-marker-default");
                    element.addEventListener("click", () => {
                        if (callbacks.onMarkerClick) {
                            callbacks.onMarkerClick(day, location);
                        }
                    });
                }

                marker.on("click", () => {
                    if (callbacks.onMarkerClick) {
                        callbacks.onMarkerClick(day, location);
                    }
                });

                list.push({ marker, location, element, day });
                markers.set(location.id, { marker, location, element, day });
            }
            markersByDay.set(String(day.number), list);
        }
    };

    const openPopup = (locationId) => {
        const entry = markers.get(locationId);
        if (!entry) {
            return;
        }
        entry.marker.openPopup();
    };

    const filterMarkers = (dayNumber) => {
        const target = String(dayNumber);
        for (const [key, entries] of markersByDay.entries()) {
            const isVisible = target === "all" || target === key;
            for (const entry of entries) {
                if (entry.element) {
                    entry.element.style.display = isVisible ? "block" : "none";
                }
                entry.marker.setOpacity(isVisible ? 1 : 0);
            }
        }
    };

    const animateRoute = (coords, speedMetersPerSecond) => {
        if (!coords || coords.length < 2) {
            return {
                promise: Promise.resolve(),
                skip: () => {},
                cancel: () => {},
            };
        }

        const { distances, total } = buildDistanceIndex(coords);
        let stopped = false;
        let skipRequested = false;

        setRoute(coords);
        setBusPosition(coords[0]);

        const promise = new Promise((resolve) => {
            const start = performance.now();

            const step = (now) => {
                if (stopped) {
                    resolve(false);
                    return;
                }
                if (skipRequested) {
                    setBusPosition(coords[coords.length - 1]);
                    resolve(true);
                    return;
                }

                const elapsed = (now - start) / 1000;
                const traveled = elapsed * speedMetersPerSecond;
                if (traveled >= total) {
                    setBusPosition(coords[coords.length - 1]);
                    resolve(true);
                    return;
                }

                const position = interpolateByDistance(coords, distances, traveled);
                setBusPosition(position);
                requestAnimationFrame(step);
            };

            requestAnimationFrame(step);
        });

        return {
            promise,
            skip: () => {
                skipRequested = true;
            },
            cancel: () => {
                stopped = true;
            },
        };
    };

    return {
        map,
        routeService,
        setMarkers,
        filterMarkers,
        setActiveMarker,
        openPopup,
        clearRoute,
        setBusPosition,
        flyToLocation,
        animateRoute,
        toLngLat,
        toLatLng,
    };
};
