(function () {
    const PLAYBACK_MODE = {
        STANDBY: "standby",
        PLAYING: "playing",
        PAUSED: "paused",
        COMPLETED: "completed",
        MANUAL_BROWSE: "manual-browse",
    };

    const DEFAULT_CONFIG = {
        defaultCenter: [14.5995, 120.9842],
        defaultZoom: 6,
        dayOverviewZoom: 10,
        locationZoom: 15,
        transitionDuration: 2.4,
        transitionZoomOutDuration: 1.6,
        introDelayMs: 900,
        sceneDelayMs: 1250,
        chapterOutroDelayMs: 750,
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    class RouteService {
        constructor(config) {
            this.config = config;
            this.cache = new Map();
        }

        static toLatLngsFromGeoJSON(coordinates) {
            if (!Array.isArray(coordinates)) {
                return [];
            }

            return coordinates
                .map((pair) => {
                    if (!Array.isArray(pair) || pair.length < 2) {
                        return null;
                    }
                    const lng = Number(pair[0]);
                    const lat = Number(pair[1]);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                        return null;
                    }
                    return [lat, lng];
                })
                .filter(Boolean);
        }

        makeCacheKey(start, end) {
            const provider = String(this.config.routeProvider).toLowerCase();
            const part = (point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
            return `${provider}:${part(start)}->${part(end)}`;
        }

        async fetchRoute(startLatLng, endLatLng, options = {}) {
            const cacheKey = this.makeCacheKey(startLatLng, endLatLng);
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached.slice();
            }

            const provider = String(this.config.routeProvider).toLowerCase();
            let route;
            const signal = options.signal;

            if (provider === "ors" || provider === "openrouteservice") {
                route = await this.fetchFromOpenRouteService(startLatLng, endLatLng, signal);
            } else {
                route = await this.fetchFromOSRM(startLatLng, endLatLng, signal);
            }

            if (route.length < 2) {
                throw new Error("Routing service returned an incomplete path.");
            }

            this.cache.set(cacheKey, route.slice());
            return route;
        }

        async fetchFromOSRM(startLatLng, endLatLng, signal) {
            const [startLat, startLng] = startLatLng;
            const [endLat, endLng] = endLatLng;
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
            return RouteService.toLatLngsFromGeoJSON(coordinates);
        }

        async fetchFromOpenRouteService(startLatLng, endLatLng, signal) {
            const apiKey = (this.config.openRouteServiceApiKey || "").trim();
            if (!apiKey) {
                throw new Error("OpenRouteService API key is missing.");
            }

            const [startLat, startLng] = startLatLng;
            const [endLat, endLng] = endLatLng;
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
            return RouteService.toLatLngsFromGeoJSON(coordinates);
        }
    }

    class TourStateManager {
        constructor(days) {
            this.days = this.normalize(days);
            this.reset();
        }

        normalize(days) {
            if (!Array.isArray(days)) {
                return [];
            }

            return days
                .map((day) => ({
                    number: Number(day.number),
                    title: (day.title || "").trim(),
                    locations: Array.isArray(day.locations)
                        ? day.locations
                            .map((loc) => ({
                                id: Number(loc.id),
                                title: (loc.title || "Untitled location").trim(),
                                description: loc.description || "",
                                reflection: loc.reflection || "",
                                imageUrls: Array.isArray(loc.image_urls)
                                    ? loc.image_urls.filter((url) => typeof url === "string" && url.length > 0)
                                    : [],
                                latitude: Number(loc.latitude),
                                longitude: Number(loc.longitude),
                                order: Number(loc.order ?? 0),
                            }))
                            .filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude))
                            .sort((a, b) => a.order - b.order || a.id - b.id)
                        : [],
                }))
                .sort((a, b) => a.number - b.number);
        }

        reset() {
            this.currentDayIndex = 0;
            this.currentLocationIndex = 0;
            this.speed = 1;
            this.isPlaying = false;
            this.isPaused = false;
            this.stopRequested = false;
            this.token = 0;
        }

        start(speed) {
            if (this.isPlaying) {
                return this.token;
            }

            this.currentDayIndex = 0;
            this.currentLocationIndex = 0;
            this.speed = Number(speed) || 1;
            this.isPlaying = true;
            this.isPaused = false;
            this.stopRequested = false;
            this.token += 1;
            return this.token;
        }

        togglePause() {
            if (!this.isPlaying) {
                return this.isPaused;
            }
            this.isPaused = !this.isPaused;
            return this.isPaused;
        }

        stop() {
            this.stopRequested = true;
            this.isPlaying = false;
            this.isPaused = false;
            this.token += 1;
        }

        setSpeed(speed) {
            const normalized = Number(speed);
            if (Number.isFinite(normalized) && normalized > 0) {
                this.speed = normalized;
            }
            return this.speed;
        }

        finish() {
            this.isPlaying = false;
            this.isPaused = false;
            this.stopRequested = false;
        }

        isTokenValid(token) {
            return token === this.token && !this.stopRequested;
        }

        currentDay() {
            return this.days[this.currentDayIndex] || null;
        }

        currentLocation() {
            const day = this.currentDay();
            if (!day) {
                return null;
            }
            return day.locations[this.currentLocationIndex] || null;
        }

        advance() {
            const day = this.currentDay();
            if (!day) {
                return false;
            }

            this.currentLocationIndex += 1;
            if (this.currentLocationIndex < day.locations.length) {
                return true;
            }

            this.currentDayIndex += 1;
            this.currentLocationIndex = 0;
            return this.currentDayIndex < this.days.length;
        }
    }

    class MapController {
        constructor(mapId, config) {
            this.config = config;
            this.routeService = new RouteService(config);
            this.map = L.map(mapId, { zoomControl: true, preferCanvas: true }).setView(config.defaultCenter, config.defaultZoom);
            L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
                subdomains: "abcd",
                maxZoom: 20,
                attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
            }).addTo(this.map);

            this.markersLayer = L.layerGroup().addTo(this.map);
            this.routeLayer = L.polyline([], {
                color: this.config.routeLineColor,
                weight: this.config.routeLineWeight,
                opacity: 0.95,
                lineJoin: "round",
            }).addTo(this.map);

            this.busMarker = null;
            this.busAnimationFrame = null;
            this.busAnimationToken = 0;
            this.activeTravelRouteLatLngs = null;
            this.travelSkipRequested = false;
            this.activeRouteFetchAbortController = null;
            this.busIcon = this.createBusIcon();

            this.activeHalo = null;
            this.markerByLocationId = new Map();
            this.markersByDay = new Map();
            this.daysByNumber = new Map();
        }

        createBusIcon() {
            if (this.config.busIconUrl) {
                return L.icon({
                    iconUrl: this.config.busIconUrl,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                    popupAnchor: [0, -16],
                });
            }

            return L.divIcon({
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
                className: "tour-bus-marker",
                iconSize: [56, 36],
                iconAnchor: [28, 18],
            });
        }

        ensureBusMarker(latlng) {
            if (this.busMarker) {
                return this.busMarker;
            }

            this.busMarker = L.marker(latlng || this.config.defaultCenter, {
                icon: this.busIcon,
                zIndexOffset: 1200,
                keyboard: false,
            }).addTo(this.map);
            return this.busMarker;
        }

        setBusPosition(latlng) {
            const marker = this.ensureBusMarker(latlng);
            marker.setLatLng(latlng);
        }

        stopBusAnimation() {
            this.busAnimationToken += 1;
            if (this.busAnimationFrame !== null) {
                window.cancelAnimationFrame(this.busAnimationFrame);
                this.busAnimationFrame = null;
            }
            this.activeTravelRouteLatLngs = null;
            this.travelSkipRequested = false;
        }

        skipBusTravel() {
            if (!Array.isArray(this.activeTravelRouteLatLngs) || this.activeTravelRouteLatLngs.length < 2) {
                return false;
            }

            this.travelSkipRequested = true;
            this.setBusPosition(this.activeTravelRouteLatLngs[this.activeTravelRouteLatLngs.length - 1]);
            return true;
        }

        static escapeHtml(text) {
            return String(text || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;");
        }

        build(days, onMarkerClick) {
            this.markerByLocationId.clear();
            this.markersByDay.clear();
            this.daysByNumber.clear();

            for (const day of days) {
                this.daysByNumber.set(String(day.number), day);
                const dayKey = String(day.number);
                const entries = [];

                for (const location of day.locations) {
                    const marker = L.marker([location.latitude, location.longitude]);
                    marker.bindPopup(this.createPopupContent(location));
                    marker.on("click", () => onMarkerClick(day, location));

                    const entry = {
                        dayNumber: day.number,
                        location,
                        marker,
                        latlng: [location.latitude, location.longitude],
                    };

                    this.markerByLocationId.set(location.id, entry);
                    entries.push(entry);
                }

                this.markersByDay.set(dayKey, entries);
            }

            this.showAllMarkers();
        }

        createPopupContent(location) {
            const reflection = location.reflection
                ? `<p style="margin-top:8px;color:#475569;font-style:italic;">${MapController.escapeHtml(location.reflection)}</p>`
                : "";

            const images = Array.isArray(location.imageUrls) ? location.imageUrls : [];
            const gallery = images.length
                ? `
                    <div style="display:flex;gap:6px;overflow-x:auto;margin-top:10px;padding-bottom:2px;">
                        ${images
                            .map(
                                (url, index) =>
                                    `<button type="button" class="tour-popup-gallery-trigger" data-full-src="${MapController.escapeHtml(url)}" data-alt="${MapController.escapeHtml(location.title)} image ${index + 1}" style="display:block;flex:0 0 auto;padding:0;background:transparent;border:0;cursor:pointer;">
                                        <img src="${MapController.escapeHtml(url)}" alt="${MapController.escapeHtml(location.title)} image ${index + 1}" style="width:76px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #d1fae5;" />
                                    </button>`
                            )
                            .join("")}
                    </div>
                `
                : "";

            const learnMoreButton = `
                <button type="button" class="tour-popup-learn-more" data-location-id="${location.id}">
                    Learn more
                </button>
            `;

            return `
                <div style="min-width:220px;">
                    <h3 style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0f172a;">${MapController.escapeHtml(location.title)}</h3>
                    <p style="margin:0;color:#334155;font-size:13px;line-height:1.4;">${MapController.escapeHtml(location.description)}</p>
                    ${reflection}
                    ${gallery}
                    ${learnMoreButton}
                </div>
            `;
        }

        showAllMarkers() {
            this.markersLayer.clearLayers();
            for (const entries of this.markersByDay.values()) {
                for (const entry of entries) {
                    this.markersLayer.addLayer(entry.marker);
                }
            }
        }

        showDayMarkers(dayNumber) {
            this.markersLayer.clearLayers();
            const entries = this.markersByDay.get(String(dayNumber)) || [];
            for (const entry of entries) {
                this.markersLayer.addLayer(entry.marker);
            }
        }

        clearRoute() {
            this.routeLayer.setLatLngs([]);
        }

        clearTravelRoute() {
            this.clearRoute();
            this.stopBusAnimation();
            this.abortRouteFetch();
            if (this.busMarker) {
                this.map.removeLayer(this.busMarker);
                this.busMarker = null;
            }
        }

        abortRouteFetch() {
            if (!this.activeRouteFetchAbortController) {
                return;
            }
            this.activeRouteFetchAbortController.abort();
            this.activeRouteFetchAbortController = null;
        }

        drawDayRoute(dayNumber, progressCount) {
            const day = this.daysByNumber.get(String(dayNumber));
            if (!day || day.locations.length === 0) {
                this.clearRoute();
                return;
            }

            const points = day.locations.map((loc) => [loc.latitude, loc.longitude]);
            if (progressCount === null || progressCount === undefined) {
                this.routeLayer.setLatLngs(points);
                return;
            }

            this.routeLayer.setLatLngs(points.slice(0, Math.max(1, progressCount)));
        }

        drawTravelRoute(routeLatLngs) {
            this.routeLayer.setLatLngs([]);
            this.routeLayer.setLatLngs(routeLatLngs);
        }

        async fetchTravelRoute(previousLocation, nextLocation) {
            const start = [previousLocation.latitude, previousLocation.longitude];
            const end = [nextLocation.latitude, nextLocation.longitude];
            this.abortRouteFetch();
            this.activeRouteFetchAbortController = new AbortController();
            try {
                return await this.routeService.fetchRoute(start, end, {
                    signal: this.activeRouteFetchAbortController.signal,
                });
            } finally {
                this.activeRouteFetchAbortController = null;
            }
        }

        computePolylineDistances(routeLatLngs) {
            const cumulative = [0];
            let total = 0;

            for (let i = 1; i < routeLatLngs.length; i += 1) {
                total += this.map.distance(routeLatLngs[i - 1], routeLatLngs[i]);
                cumulative.push(total);
            }

            return { cumulative, total };
        }

        interpolateOnRoute(routeLatLngs, cumulative, distanceMeters) {
            if (distanceMeters <= 0) {
                return routeLatLngs[0];
            }

            const total = cumulative[cumulative.length - 1] || 0;
            if (distanceMeters >= total) {
                return routeLatLngs[routeLatLngs.length - 1];
            }

            let segmentIndex = 1;
            while (segmentIndex < cumulative.length && cumulative[segmentIndex] < distanceMeters) {
                segmentIndex += 1;
            }

            const startIndex = Math.max(0, segmentIndex - 1);
            const endIndex = Math.min(routeLatLngs.length - 1, segmentIndex);
            const segmentStartDistance = cumulative[startIndex];
            const segmentEndDistance = cumulative[endIndex];
            const segmentLength = Math.max(1e-6, segmentEndDistance - segmentStartDistance);
            const ratio = (distanceMeters - segmentStartDistance) / segmentLength;

            const start = routeLatLngs[startIndex];
            const end = routeLatLngs[endIndex];
            const lat = start[0] + (end[0] - start[0]) * ratio;
            const lng = start[1] + (end[1] - start[1]) * ratio;
            return [lat, lng];
        }

        async animateBusAlongRoute(routeLatLngs, options) {
            if (!Array.isArray(routeLatLngs) || routeLatLngs.length < 2) {
                return false;
            }

            const tokenValidator = options?.tokenValidator || (() => true);
            const isPaused = options?.isPaused || (() => false);
            const getSpeedMultiplier = options?.getSpeedMultiplier || (() => 1);

            this.stopBusAnimation();
            const animationToken = ++this.busAnimationToken;
            this.activeTravelRouteLatLngs = routeLatLngs.slice();
            this.travelSkipRequested = false;
            this.setBusPosition(routeLatLngs[0]);

            const { cumulative, total } = this.computePolylineDistances(routeLatLngs);
            if (total <= 0) {
                this.setBusPosition(routeLatLngs[routeLatLngs.length - 1]);
                return tokenValidator();
            }

            const targetSeconds = 3;
            const baseSpeed = Math.max(1, total / Math.max(0.5, targetSeconds));
            let travelled = 0;
            let lastFrameTime = null;

            return new Promise((resolve) => {
                const step = (frameTime) => {
                    if (this.travelSkipRequested && animationToken === this.busAnimationToken) {
                        this.setBusPosition(routeLatLngs[routeLatLngs.length - 1]);
                        this.activeTravelRouteLatLngs = null;
                        this.travelSkipRequested = false;
                        resolve(tokenValidator());
                        return;
                    }

                    if (animationToken !== this.busAnimationToken || !tokenValidator()) {
                        this.activeTravelRouteLatLngs = null;
                        this.travelSkipRequested = false;
                        resolve(false);
                        return;
                    }

                    if (lastFrameTime === null) {
                        lastFrameTime = frameTime;
                    }

                    const deltaSeconds = Math.max(0, (frameTime - lastFrameTime) / 1000);
                    lastFrameTime = frameTime;

                    if (!isPaused()) {
                        const speedMultiplier = Math.max(0.1, Number(getSpeedMultiplier()) || 1);
                        travelled += deltaSeconds * baseSpeed * speedMultiplier;
                        const current = this.interpolateOnRoute(routeLatLngs, cumulative, travelled);
                        this.setBusPosition(current);
                    }

                    if (travelled >= total) {
                        this.setBusPosition(routeLatLngs[routeLatLngs.length - 1]);
                        this.activeTravelRouteLatLngs = null;
                        this.travelSkipRequested = false;
                        resolve(tokenValidator());
                        return;
                    }

                    this.busAnimationFrame = window.requestAnimationFrame(step);
                };

                this.busAnimationFrame = window.requestAnimationFrame(step);
            });
        }

        async flyTo(latlng, zoom, durationSeconds, tokenValidator) {
            return new Promise((resolve) => {
                if (!tokenValidator()) {
                    resolve(false);
                    return;
                }

                let completed = false;
                const done = () => {
                    if (completed) {
                        return;
                    }
                    completed = true;
                    this.map.off("moveend", onMoveEnd);
                    resolve(tokenValidator());
                };

                const onMoveEnd = () => done();
                this.map.on("moveend", onMoveEnd);
                this.map.flyTo(latlng, zoom, { duration: durationSeconds, easeLinearity: 0.2 });
                setTimeout(done, Math.max(700, durationSeconds * 1000 + 500));
            });
        }

        async flyToDayOverview(dayNumber, tokenValidator) {
            const entries = this.markersByDay.get(String(dayNumber)) || [];
            if (entries.length === 0) {
                return false;
            }

            const bounds = entries.map((entry) => entry.latlng);
            if (bounds.length === 1) {
                return this.flyTo(bounds[0], this.config.dayOverviewZoom, this.config.transitionDuration, tokenValidator);
            }

            this.map.fitBounds(bounds, { padding: [30, 30] });
            return sleep(300).then(() => tokenValidator());
        }

        async flyBetweenLocations(previousLocation, nextLocation, speed, tokenValidator) {
            if (previousLocation) {
                const midpoint = [
                    (previousLocation.latitude + nextLocation.latitude) / 2,
                    (previousLocation.longitude + nextLocation.longitude) / 2,
                ];

                const zoomOutOk = await this.flyTo(
                    midpoint,
                    this.config.dayOverviewZoom + 1,
                    this.config.transitionZoomOutDuration / speed,
                    tokenValidator
                );

                if (!zoomOutOk) {
                    return false;
                }
            }

            return this.flyTo(
                [nextLocation.latitude, nextLocation.longitude],
                this.config.locationZoom,
                this.config.transitionDuration / speed,
                tokenValidator
            );
        }

        setActiveMarker(locationId) {
            const entry = this.markerByLocationId.get(locationId);
            if (!entry) {
                return;
            }

            if (this.activeHalo) {
                this.map.removeLayer(this.activeHalo);
            }

            this.activeHalo = L.circleMarker(entry.latlng, {
                radius: 16,
                color: "#38bdf8",
                fillColor: "#7dd3fc",
                fillOpacity: 0.15,
                weight: 2,
            }).addTo(this.map);

            entry.marker.openPopup();
        }

        closeActivePopup() {
            this.map.closePopup();
        }

        resetView() {
            this.clearTravelRoute();
            this.closeActivePopup();
            if (this.activeHalo) {
                this.map.removeLayer(this.activeHalo);
                this.activeHalo = null;
            }
            this.showAllMarkers();
            this.map.flyTo(this.config.defaultCenter, this.config.defaultZoom, { duration: 1.2 });
        }
    }

    class UIController {
        constructor() {
            this.locationCards = Array.from(document.querySelectorAll(".location-card"));
            this.daySections = Array.from(document.querySelectorAll(".day-section"));
            this.filterButtons = Array.from(document.querySelectorAll(".day-filter-btn"));
            this.locationsPanel = document.getElementById("locations-panel");
            this.globalEmptyState = document.getElementById("global-empty-state");
            this.nowViewing = document.getElementById("now-viewing");
            this.chapterStatus = document.getElementById("chapter-status");

            this.playButton = document.getElementById("play-tour-btn");
            this.pauseButton = document.getElementById("pause-tour-btn");
            this.stopButton = document.getElementById("stop-tour-btn");
            this.prevButton = document.getElementById("prev-location-btn");
            this.nextButton = document.getElementById("next-location-btn");
            this.skipTravelButton = document.getElementById("skip-travel-btn");
            this.prevTargetLabel = document.getElementById("prev-target-label");
            this.nextTargetLabel = document.getElementById("next-target-label");
            this.speedControl = document.getElementById("speed-control");
            this.speedControlValue = document.getElementById("speed-control-value");
            this.sceneFocusReopenButton = document.getElementById("scene-focus-reopen");
            this.sceneFocusFinishButton = document.getElementById("scene-focus-finish");

            this.modeText = {
                [PLAYBACK_MODE.STANDBY]: "Standby",
                [PLAYBACK_MODE.PLAYING]: "Playing",
                [PLAYBACK_MODE.PAUSED]: "Paused",
                [PLAYBACK_MODE.COMPLETED]: "Completed",
                [PLAYBACK_MODE.MANUAL_BROWSE]: "Manual Browse",
            };

            this.modeClass = {
                [PLAYBACK_MODE.STANDBY]: "text-slate-700",
                [PLAYBACK_MODE.PLAYING]: "text-emerald-700",
                [PLAYBACK_MODE.PAUSED]: "text-amber-700",
                [PLAYBACK_MODE.COMPLETED]: "text-slate-700",
                [PLAYBACK_MODE.MANUAL_BROWSE]: "text-sky-700",
            };

            this.modeClasses = ["text-slate-700", "text-emerald-700", "text-amber-700", "text-sky-700"];
        }

        getSpeed() {
            return this.speedControl ? Number(this.speedControl.value || "1") : 1;
        }

        updateSpeedLabel(speed) {
            if (!this.speedControlValue) {
                return;
            }
            this.speedControlValue.textContent = `${Number(speed).toFixed(1)}x`;
        }

        setControls(state) {
            this.playButton.disabled = state.isPlaying;
            this.playButton.classList.toggle("opacity-60", state.isPlaying);
            this.playButton.classList.toggle("hover:bg-emerald-500", !state.isPlaying);
            this.pauseButton.disabled = !state.isPlaying;
            this.stopButton.disabled = !state.isPlaying;
            if (this.skipTravelButton) {
                const canSkipTravel = !!state.canSkipTravel;
                this.skipTravelButton.disabled = !canSkipTravel;
                this.skipTravelButton.classList.toggle("opacity-60", !canSkipTravel);
                this.skipTravelButton.classList.toggle("cursor-not-allowed", !canSkipTravel);
            }
            if (this.prevButton) {
                this.prevButton.disabled = state.isPlaying;
            }
            if (this.nextButton) {
                this.nextButton.disabled = state.isPlaying;
            }
            this.pauseButton.textContent = state.isPaused ? "Resume" : "Pause";
        }

        updateBrowseTargets(prevName, nextName) {
            const prevText = prevName ? `Prev: ${prevName}` : "Prev: -";
            const nextText = nextName ? `Next: ${nextName}` : "Next: -";

            if (this.prevButton) {
                this.prevButton.title = prevName ? `Go to previous: ${prevName}` : "No previous location available";
                this.prevButton.setAttribute("aria-label", prevName ? `Previous location: ${prevName}` : "Previous location unavailable");
            }

            if (this.nextButton) {
                this.nextButton.title = nextName ? `Go to next: ${nextName}` : "No next location available";
                this.nextButton.setAttribute("aria-label", nextName ? `Next location: ${nextName}` : "Next location unavailable");
            }

            if (this.prevTargetLabel) {
                this.prevTargetLabel.textContent = prevText;
            }

            if (this.nextTargetLabel) {
                this.nextTargetLabel.textContent = nextText;
            }
        }

        setPlaybackMode(mode) {
            this.chapterStatus.textContent = this.modeText[mode] || this.modeText[PLAYBACK_MODE.STANDBY];
            this.chapterStatus.classList.remove(...this.modeClasses);
            this.chapterStatus.classList.add(this.modeClass[mode] || this.modeClass[PLAYBACK_MODE.STANDBY]);
            if (this.sceneFocusFinishButton) {
                const showFinish = mode === PLAYBACK_MODE.PLAYING || mode === PLAYBACK_MODE.PAUSED;
                this.sceneFocusFinishButton.classList.toggle("hidden", !showFinish);
            }
        }

        setChapterStatus(text) {
            this.chapterStatus.textContent = text;
        }

        setNowViewing(text) {
            this.nowViewing.textContent = text;
        }

        setFilterButton(dayValue) {
            const normalized = String(dayValue);
            for (const button of this.filterButtons) {
                const active = button.dataset.day === normalized;
                button.classList.toggle("bg-emerald-600", active);
                button.classList.toggle("text-white", active);
                button.classList.toggle("bg-white", !active);
                button.classList.toggle("text-emerald-800", !active);
            }
        }

        setVisibleDay(dayValue) {
            const normalized = String(dayValue);
            let visibleCount = 0;

            for (const section of this.daySections) {
                const show = normalized === "all" || section.dataset.daySection === normalized;
                section.classList.toggle("hidden", !show);
            }

            for (const card of this.locationCards) {
                const show = normalized === "all" || card.dataset.day === normalized;
                card.classList.toggle("hidden", !show);
                if (show) {
                    visibleCount += 1;
                }
            }

            this.globalEmptyState.classList.toggle("hidden", visibleCount > 0);

            if (typeof window.openTourDayAccordion === "function") {
                window.openTourDayAccordion(normalized);
            }
        }

        clearHighlights() {
            for (const section of this.daySections) {
                section.classList.remove("ring-2", "ring-emerald-300", "bg-emerald-50/60");
            }
            for (const card of this.locationCards) {
                card.classList.remove("ring-2", "ring-emerald-400", "ring-offset-1", "bg-emerald-50");
            }
        }

        activateDay(dayNumber) {
            const section = document.querySelector(`[data-day-section="${dayNumber}"]`);
            if (!section || section.classList.contains("hidden")) {
                return;
            }

            if (typeof window.openTourDayAccordion === "function") {
                window.openTourDayAccordion(dayNumber);
            }

            for (const s of this.daySections) {
                s.classList.remove("ring-2", "ring-emerald-300", "bg-emerald-50/60");
            }
            section.classList.add("ring-2", "ring-emerald-300", "bg-emerald-50/60");
            this.scrollToElement(section, 10);
        }

        activateLocation(locationId) {
            const card = document.querySelector(`[data-location-id="${locationId}"]`);
            if (!card || card.classList.contains("hidden")) {
                return;
            }

            for (const c of this.locationCards) {
                c.classList.remove("ring-2", "ring-emerald-400", "ring-offset-1", "bg-emerald-50");
            }
            card.classList.add("ring-2", "ring-emerald-400", "ring-offset-1", "bg-emerald-50");
            this.scrollToElement(card, 12);
        }

        scrollToElement(element, topOffset) {
            const panelTop = this.locationsPanel.getBoundingClientRect().top;
            const targetTop = element.getBoundingClientRect().top;
            const nextScrollTop = this.locationsPanel.scrollTop + (targetTop - panelTop) - topOffset;
            this.locationsPanel.scrollTo({ top: Math.max(0, nextScrollTop), behavior: "smooth" });
        }

        bindControls(handlers) {
            this.playButton.addEventListener("click", handlers.onPlay);
            this.pauseButton.addEventListener("click", handlers.onPause);
            this.stopButton.addEventListener("click", handlers.onStop);
            if (this.skipTravelButton && typeof handlers.onSkipTravel === "function") {
                this.skipTravelButton.addEventListener("click", handlers.onSkipTravel);
            }
            if (this.prevButton && typeof handlers.onPrev === "function") {
                this.prevButton.addEventListener("click", handlers.onPrev);
            }
            if (this.nextButton && typeof handlers.onNext === "function") {
                this.nextButton.addEventListener("click", handlers.onNext);
            }
            if (this.sceneFocusReopenButton && typeof handlers.onFocusReopen === "function") {
                this.sceneFocusReopenButton.addEventListener("click", handlers.onFocusReopen);
            }
            if (this.sceneFocusFinishButton && typeof handlers.onFocusFinish === "function") {
                this.sceneFocusFinishButton.addEventListener("click", handlers.onFocusFinish);
            }
        }

        bindSpeedControl(onSpeedChange) {
            if (!this.speedControl) {
                return;
            }
            const handleSpeedUpdate = () => {
                const nextSpeed = Number(this.speedControl.value || "1");
                this.updateSpeedLabel(nextSpeed);
                onSpeedChange(nextSpeed);
            };
            this.speedControl.addEventListener("change", handleSpeedUpdate);
            this.speedControl.addEventListener("input", handleSpeedUpdate);
            this.updateSpeedLabel(this.getSpeed());
            handleSpeedUpdate();
        }

        bindFilters(onFilter) {
            for (const button of this.filterButtons) {
                button.addEventListener("click", () => onFilter(button.dataset.day));
            }
        }

        bindLocationCards(onCardClick) {
            for (const card of this.locationCards) {
                card.addEventListener("click", () => onCardClick(Number(card.dataset.locationId)));
            }
        }
    }

    class SceneFocusController {
        constructor(uiController) {
            this.ui = uiController;
            this.modal = document.getElementById("scene-focus-modal");
            this.panel = document.getElementById("scene-focus-panel");
            this.meta = document.getElementById("scene-focus-meta");
            this.title = document.getElementById("scene-focus-title");
            this.description = document.getElementById("scene-focus-description");
            this.reflection = document.getElementById("scene-focus-reflection");
            this.heroImage = document.getElementById("scene-focus-hero-img");
            this.imageCounter = document.getElementById("scene-focus-image-counter");
            this.thumbnails = document.getElementById("scene-focus-thumbnails");
            this.prevImageButton = document.getElementById("scene-focus-prev-img");
            this.nextImageButton = document.getElementById("scene-focus-next-img");
            this.closeButton = document.getElementById("scene-focus-close");
            this.liveRegion = document.getElementById("scene-focus-live");
            this.reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            this.activeLocation = null;
            this.activeDayNumber = null;
            this.activeSceneIndex = 1;
            this.activeSceneTotal = 1;
            this.images = [];
            this.imageIndex = 0;
            this.isOpen = false;
            this.imageAutoplayTimer = null;
            this.lastFocusedElement = null;
            this.closeTimer = null;

            this.bindEvents();
        }

        isAvailable() {
            return !!(
                this.modal && this.panel && this.meta && this.title && this.description && this.reflection && this.heroImage &&
                this.imageCounter && this.thumbnails && this.prevImageButton && this.nextImageButton && this.closeButton &&
                this.liveRegion
            );
        }

        bindEvents() {
            if (!this.isAvailable()) {
                return;
            }

            this.prevImageButton.addEventListener("click", () => this.moveImageBy(-1, true));
            this.nextImageButton.addEventListener("click", () => this.moveImageBy(1, true));
            this.closeButton.addEventListener("click", () => this.close());

            this.thumbnails.addEventListener("click", (event) => {
                const button = event.target.closest("[data-scene-thumb-index]");
                if (!button) {
                    return;
                }
                const idx = Number(button.getAttribute("data-scene-thumb-index"));
                if (!Number.isInteger(idx)) {
                    return;
                }
                this.selectImage(idx, true);
            });

            this.thumbnails.addEventListener("keydown", (event) => {
                const button = event.target.closest("[data-scene-thumb-index]");
                if (!button) {
                    return;
                }
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    const idx = Number(button.getAttribute("data-scene-thumb-index"));
                    this.selectImage(idx, true);
                }
            });

            this.modal.addEventListener("click", (event) => {
                if (event.target === this.modal) {
                    this.close();
                }
            });

            document.addEventListener("keydown", (event) => {
                if (!this.isOpen) {
                    return;
                }

                if (event.key === "Escape") {
                    event.preventDefault();
                    this.close();
                    return;
                }
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    this.moveImageBy(-1, true);
                    return;
                }
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    this.moveImageBy(1, true);
                    return;
                }
                if (event.key === "Tab") {
                    this.trapFocus(event);
                }
            });
        }

        trapFocus(event) {
            const focusable = Array.from(this.modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
                .filter((el) => !el.hasAttribute("disabled"));
            if (!focusable.length) {
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        }

        setSceneContext(dayNumber, location, sceneIndex, sceneTotal) {
            this.activeDayNumber = dayNumber;
            this.activeLocation = location;
            this.activeSceneIndex = sceneIndex;
            this.activeSceneTotal = sceneTotal;
            this.images = Array.isArray(location?.imageUrls) && location.imageUrls.length
                ? location.imageUrls.slice()
                : [];
            this.imageIndex = 0;
        }

        updateScene(dayNumber, location, sceneIndex, sceneTotal, shouldOpen = true) {
            if (!this.isAvailable() || !location) {
                return;
            }

            this.setSceneContext(dayNumber, location, sceneIndex, sceneTotal);

            // Keep default map/panel experience when the location has no gallery images.
            if (!this.images.length) {
                this.close();
                return;
            }

            this.title.textContent = location.title || "Untitled location";
            this.meta.textContent = `Day ${dayNumber} - Itinerary ${sceneIndex}/${sceneTotal}`;
            this.description.textContent = location.description || "No description provided.";
            this.reflection.textContent = location.reflection || "No reflection provided.";
            this.reflection.classList.toggle("hidden", !location.reflection);

            this.renderThumbnails();
            this.renderImage();
            if (!shouldOpen) {
                this.stopImageAutoplay();
                return;
            }

            this.show();
            this.runRevealSequence();
            this.announceScene();
            this.startImageAutoplay();
        }

        announceScene() {
            if (!this.liveRegion || !this.activeLocation) {
                return;
            }
            this.liveRegion.textContent = `Now focusing Day ${this.activeDayNumber}, Itinerary ${this.activeSceneIndex} of ${this.activeSceneTotal}: ${this.activeLocation.title}`;
        }

        runRevealSequence() {
            const revealBlocks = [this.description, this.reflection].filter(Boolean);
            revealBlocks.forEach((node) => node.classList.remove("scene-focus-visible"));

            if (this.reducedMotion) {
                revealBlocks.forEach((node) => node.classList.add("scene-focus-visible"));
                return;
            }

            setTimeout(() => this.description.classList.add("scene-focus-visible"), 500);
            if (!this.reflection.classList.contains("hidden")) {
                setTimeout(() => this.reflection.classList.add("scene-focus-visible"), 800);
            }
        }

        renderThumbnails() {
            if (!this.thumbnails) {
                return;
            }
            this.thumbnails.innerHTML = this.images
                .map((src, idx) => {
                    const activeClass = idx === this.imageIndex ? "is-active" : "";
                    return `
                        <button type="button" data-scene-thumb-index="${idx}" class="scene-focus-thumb ${activeClass} inline-flex h-14 w-20 flex-none overflow-hidden rounded-lg bg-white" aria-label="Show image ${idx + 1}">
                            <img src="${MapController.escapeHtml(src)}" alt="${MapController.escapeHtml(this.activeLocation?.title || "Itinerary image")} ${idx + 1}" class="h-full w-full object-cover">
                        </button>
                    `;
                })
                .join("");

            const hasOverflow = this.thumbnails.scrollWidth > this.thumbnails.clientWidth + 2;
            this.thumbnails.classList.toggle("thumbs-centered", !hasOverflow);
            if (hasOverflow) {
                this.thumbnails.scrollLeft = 0;
            }
        }

        renderImage() {
            if (!this.heroImage) {
                return;
            }

            const fallbackAlt = this.activeLocation?.title || "Itinerary image";
            const src = this.images[this.imageIndex] || "";
            this.heroImage.src = src;
            this.heroImage.alt = src ? `${fallbackAlt} image ${this.imageIndex + 1}` : fallbackAlt;

            const total = Math.max(1, this.images.length);
            this.imageCounter.textContent = `${Math.min(this.imageIndex + 1, total)}/${total}`;

            this.prevImageButton.disabled = this.imageIndex <= 0;
            this.nextImageButton.disabled = this.imageIndex >= total - 1;

            this.prevImageButton.style.opacity = this.prevImageButton.disabled ? "0.5" : "1";
            this.nextImageButton.style.opacity = this.nextImageButton.disabled ? "0.5" : "1";

            this.renderThumbnails();
        }

        selectImage(index, manual = false) {
            const total = Math.max(1, this.images.length);
            const next = Math.max(0, Math.min(index, total - 1));
            if (next === this.imageIndex) {
                return;
            }
            this.imageIndex = next;
            this.renderImage();
            if (manual) {
                this.startImageAutoplay();
            }
        }

        moveImageBy(offset, manual = false) {
            this.selectImage(this.imageIndex + offset, manual);
        }

        getRecommendedHoldMs(baseMs) {
            const totalImages = Math.max(1, this.images.length);
            const perImageMs = 2300;
            const expanded = baseMs + (totalImages - 1) * perImageMs;
            return Math.max(baseMs, Math.min(expanded, 22000));
        }

        show() {
            if (!this.isAvailable()) {
                return;
            }

            if (this.closeTimer) {
                window.clearTimeout(this.closeTimer);
                this.closeTimer = null;
            }

            this.lastFocusedElement = document.activeElement;
            this.modal.classList.remove("is-visible");
            this.modal.classList.remove("hidden");
            this.modal.classList.add("flex");
            this.isOpen = true;

            // Force a layout pass so the initial hidden state is committed before transition.
            void this.modal.offsetWidth;

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    this.modal.classList.add("is-visible");
                    this.renderThumbnails();
                });
            });
            this.closeButton.focus({ preventScroll: true });
        }

        close() {
            if (!this.modal) {
                return;
            }

            if (this.closeTimer) {
                window.clearTimeout(this.closeTimer);
                this.closeTimer = null;
            }

            this.modal.classList.remove("is-visible");
            this.isOpen = false;
            this.stopImageAutoplay();

            this.closeTimer = window.setTimeout(() => {
                this.modal.classList.add("hidden");
                this.modal.classList.remove("flex");
                this.closeTimer = null;
            }, 420);

            if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === "function") {
                this.lastFocusedElement.focus({ preventScroll: true });
            }
        }

        reopen() {
            if (!this.activeLocation) {
                return;
            }
            this.show();
            this.startImageAutoplay();
        }

        startImageAutoplay() {
            this.stopImageAutoplay();
            if (this.images.length <= 1) {
                return;
            }
            const delay = 2600;
            this.imageAutoplayTimer = window.setInterval(() => {
                if (!this.isOpen) {
                    return;
                }
                if (this.imageIndex >= this.images.length - 1) {
                    this.stopImageAutoplay();
                    return;
                }
                const next = this.imageIndex + 1;
                this.selectImage(next, false);
            }, delay);
        }

        stopImageAutoplay() {
            if (this.imageAutoplayTimer) {
                window.clearInterval(this.imageAutoplayTimer);
                this.imageAutoplayTimer = null;
            }
        }
    }

    class PlaybackController {
        constructor(state, mapController, uiController, sceneFocusController, config) {
            this.state = state;
            this.map = mapController;
            this.ui = uiController;
            this.sceneFocus = sceneFocusController;
            this.config = config;
            this.activeManualDay = "all";
            this.hasManualFocus = false;
            this.currentManualLocationId = null;
            this.canSkipTravel = false;
            this.skipSceneHold = false;
        }

        tokenValidator(token) {
            return () => this.state.isTokenValid(token);
        }

        async wait(baseMs, token, options = {}) {
            const useSpeedScaling = options.useSpeedScaling !== false;
            const allowSkip = options.allowSkip === true;
            let progressedMs = 0;
            let tickAt = Date.now();

            while (progressedMs < baseMs) {
                if (!this.state.isTokenValid(token)) {
                    return false;
                }

                if (allowSkip && this.skipSceneHold) {
                    this.skipSceneHold = false;
                    return true;
                }

                while (this.state.isPaused) {
                    if (!this.state.isTokenValid(token)) {
                        return false;
                    }
                    await sleep(120);
                    tickAt = Date.now();
                }

                await sleep(80);
                const now = Date.now();
                const delta = now - tickAt;
                tickAt = now;
                const speedFactor = useSpeedScaling ? this.state.speed : 1;
                progressedMs += delta * speedFactor;
            }
            return true;
        }

        finishSceneFocus() {
            this.sceneFocus.close();
            if (this.state.isPlaying) {
                this.skipSceneHold = true;
            }
        }

        updateSpeed(speed) {
            this.state.setSpeed(speed);
        }

        updateTourControls(canSkipTravel = this.canSkipTravel) {
            this.canSkipTravel = !!canSkipTravel;
            this.ui.setControls({
                isPlaying: this.state.isPlaying,
                isPaused: this.state.isPaused,
                canSkipTravel: this.canSkipTravel,
            });
        }

        getBrowseLocations() {
            if (this.activeManualDay === "all") {
                return this.state.days.flatMap((day) => day.locations);
            }

            const targetDay = this.state.days.find((day) => String(day.number) === String(this.activeManualDay));
            return targetDay ? targetDay.locations : [];
        }

        syncBrowseTargets() {
            if (this.state.isPlaying) {
                const day = this.state.currentDay();
                if (!day || !day.locations.length) {
                    this.ui.updateBrowseTargets(null, null);
                    return;
                }

                const currentIndex = this.state.currentLocationIndex;
                const prevName = currentIndex <= 0 ? null : day.locations[currentIndex - 1].title;
                const nextName = currentIndex >= day.locations.length - 1 ? null : day.locations[currentIndex + 1].title;
                this.ui.updateBrowseTargets(prevName, nextName);
                return;
            }

            const locations = this.getBrowseLocations();
            if (!locations.length) {
                this.ui.updateBrowseTargets(null, null);
                return;
            }

            const currentIndex = locations.findIndex((loc) => loc.id === this.currentManualLocationId);
            const prevName = currentIndex <= 0 ? null : locations[currentIndex - 1].title;
            const nextName = currentIndex === -1
                ? locations[0].title
                : (currentIndex >= locations.length - 1 ? null : locations[currentIndex + 1].title);

            this.ui.updateBrowseTargets(prevName, nextName);
        }

        openManualEntry(entry, flyDuration, openSceneFocus = false) {
            if (!entry) {
                return;
            }

            this.applyManualFilter(entry.dayNumber);
            this.hasManualFocus = true;
            this.currentManualLocationId = entry.location.id;
            this.map.setActiveMarker(entry.location.id);
            this.ui.activateDay(entry.dayNumber);
            this.ui.activateLocation(entry.location.id);
            this.ui.setPlaybackMode(PLAYBACK_MODE.MANUAL_BROWSE);
            this.ui.setNowViewing(`Now Viewing: Day ${entry.dayNumber} - ${entry.location.title}`);
            this.map.map.flyTo(entry.latlng, this.config.locationZoom, { duration: flyDuration });
            const day = this.state.days.find((item) => item.number === entry.dayNumber);
            const total = day ? day.locations.length : 1;
            const idx = day ? Math.max(0, day.locations.findIndex((loc) => loc.id === entry.location.id)) : 0;
            this.sceneFocus.updateScene(entry.dayNumber, entry.location, idx + 1, total, openSceneFocus);
            this.syncBrowseTargets();
        }

        browseStep(direction) {
            if (this.state.isPlaying) {
                return;
            }

            const locations = this.getBrowseLocations();
            if (!locations.length) {
                return;
            }

            const currentIndex = locations.findIndex((loc) => loc.id === this.currentManualLocationId);
            let nextIndex;
            if (direction > 0) {
                nextIndex = currentIndex === -1 ? 0 : currentIndex + 1;
            } else {
                nextIndex = currentIndex <= 0 ? -1 : currentIndex - 1;
            }

            if (nextIndex < 0 || nextIndex >= locations.length) {
                return;
            }

            const targetLocation = locations[nextIndex];
            const entry = this.map.markerByLocationId.get(targetLocation.id);
            this.openManualEntry(entry, 1.1, false);
        }

        setIdleStateMessage() {
            if (this.hasManualFocus) {
                this.ui.setPlaybackMode(PLAYBACK_MODE.MANUAL_BROWSE);
                return;
            }

            this.ui.setPlaybackMode(PLAYBACK_MODE.STANDBY);
            this.ui.setNowViewing("Now Viewing: Waiting To Start");
        }

        applyManualFilter(dayValue) {
            if (this.state.isPlaying) {
                return;
            }

            this.activeManualDay = String(dayValue);
            this.hasManualFocus = false;
            this.currentManualLocationId = null;
            this.ui.setFilterButton(this.activeManualDay);
            this.ui.clearHighlights();
            this.ui.setVisibleDay(this.activeManualDay);

            if (this.activeManualDay === "all") {
                this.map.showAllMarkers();
                this.map.clearRoute();
                this.setIdleStateMessage();
                this.syncBrowseTargets();
                return;
            }

            this.map.showDayMarkers(this.activeManualDay);
            this.map.drawDayRoute(this.activeManualDay, null);
            this.setIdleStateMessage();
            this.syncBrowseTargets();
        }

        async playTour() {
            if (this.state.isPlaying) {
                return;
            }

            const token = this.state.start(this.ui.getSpeed());
            this.canSkipTravel = false;
            this.hasManualFocus = false;
            this.currentManualLocationId = null;
            this.updateTourControls(false);
            this.ui.setPlaybackMode(PLAYBACK_MODE.PLAYING);
            this.ui.setNowViewing("Now Viewing: Tour started");
            this.map.closeActivePopup();
            this.map.clearTravelRoute();
            this.syncBrowseTargets();

            try {
                let canAdvance = true;
                while (canAdvance && this.state.isTokenValid(token)) {
                    canAdvance = await this.nextStep(token);
                }
            } finally {
                const supersededByNewRun = token !== this.state.token && this.state.isPlaying;
                if (supersededByNewRun) {
                    return;
                }

                const stopped = this.state.stopRequested || !this.state.isTokenValid(token);
                this.state.finish();
                this.canSkipTravel = false;
                this.updateTourControls(false);

                if (stopped) {
                    this.ui.setPlaybackMode(PLAYBACK_MODE.STANDBY);
                    this.ui.setNowViewing("Now Viewing: Waiting To Start");
                } else {
                    this.ui.clearHighlights();
                    this.ui.setFilterButton("all");
                    this.ui.setVisibleDay("all");
                    this.map.resetView();
                    this.ui.setPlaybackMode(PLAYBACK_MODE.COMPLETED);
                    this.ui.setNowViewing("Now Viewing: Tour complete");
                }

                this.syncBrowseTargets();
            }
        }

        pauseTour() {
            if (!this.state.isPlaying) {
                return;
            }

            const paused = this.state.togglePause();
            this.updateTourControls(this.canSkipTravel);
            this.ui.setPlaybackMode(paused ? PLAYBACK_MODE.PAUSED : PLAYBACK_MODE.PLAYING);
        }

        stopTour() {
            if (!this.state.isPlaying) {
                this.hasManualFocus = false;
                this.activeManualDay = "all";
                this.currentManualLocationId = null;
                this.ui.clearHighlights();
                this.ui.setFilterButton("all");
                this.ui.setVisibleDay("all");
                this.map.resetView();
                this.map.closeActivePopup();
                this.ui.setPlaybackMode(PLAYBACK_MODE.STANDBY);
                this.ui.setNowViewing("Now Viewing: Waiting to start");
                this.sceneFocus.close();
                this.syncBrowseTargets();
                return;
            }

            this.state.stop();
            this.hasManualFocus = false;
            this.activeManualDay = "all";
            this.currentManualLocationId = null;
            this.canSkipTravel = false;
            this.updateTourControls(false);
            this.map.abortRouteFetch();
            this.map.stopBusAnimation();
            this.map.resetView();
            this.map.closeActivePopup();
            this.ui.clearHighlights();
            this.ui.setFilterButton("all");
            this.ui.setVisibleDay("all");
            this.ui.setPlaybackMode(PLAYBACK_MODE.STANDBY);
            this.ui.setNowViewing("Now Viewing: Waiting To Start");
            this.sceneFocus.close();
            this.syncBrowseTargets();
        }

        async nextStep(token) {
            const day = this.state.currentDay();
            const location = this.state.currentLocation();

            if (!day || !location) {
                return false;
            }

            if (this.state.currentLocationIndex === 0) {
                this.ui.setFilterButton(day.number);
                this.ui.setVisibleDay(day.number);
                this.ui.activateDay(day.number);
                this.ui.setPlaybackMode(PLAYBACK_MODE.PLAYING);
                this.ui.setNowViewing(`Now Viewing: Day ${day.number} Intro`);
                this.map.showDayMarkers(day.number);
                this.map.clearRoute();

                const overviewOk = await this.map.flyToDayOverview(day.number, this.tokenValidator(token));
                if (!overviewOk) {
                    return false;
                }

                const introOk = await this.wait(this.config.introDelayMs, token);
                if (!introOk) {
                    return false;
                }
            }

            const previous = this.state.currentLocationIndex > 0
                ? day.locations[this.state.currentLocationIndex - 1]
                : null;

            if (!previous) {
                const firstHopOk = await this.map.flyTo(
                    [location.latitude, location.longitude],
                    this.config.locationZoom,
                    this.config.transitionDuration / this.state.speed,
                    this.tokenValidator(token)
                );
                if (!firstHopOk) {
                    return false;
                }
                this.map.setBusPosition([location.latitude, location.longitude]);
                this.map.clearRoute();
            } else {
                const start = [previous.latitude, previous.longitude];
                const end = [location.latitude, location.longitude];
                let travelRoute = [];

                this.sceneFocus.close();
                this.ui.setNowViewing(`Traveling: ${previous.title} -> ${location.title}`);

                try {
                    travelRoute = await this.map.fetchTravelRoute(previous, location);
                } catch (error) {
                    if (error && error.name === "AbortError") {
                        return false;
                    }
                    console.error("Route fetch failed, falling back to straight segment.", error);
                    travelRoute = [start, end];
                }

                this.map.drawTravelRoute(travelRoute);
                this.map.map.fitBounds(travelRoute, { padding: [48, 48], maxZoom: 13 });

                this.canSkipTravel = true;
                this.updateTourControls(true);

                let routeOk = false;
                try {
                    routeOk = await this.map.animateBusAlongRoute(travelRoute, {
                        tokenValidator: this.tokenValidator(token),
                        isPaused: () => this.state.isPaused,
                        getSpeedMultiplier: () => this.state.speed,
                    });
                } finally {
                    this.canSkipTravel = false;
                    this.updateTourControls(false);
                }
                if (!routeOk) {
                    return false;
                }
            }

            this.map.setActiveMarker(location.id);
            this.ui.activateDay(day.number);
            this.ui.activateLocation(location.id);
            this.ui.setNowViewing(`Now Viewing: ${location.title}`);
            this.sceneFocus.updateScene(day.number, location, this.state.currentLocationIndex + 1, day.locations.length);
            this.syncBrowseTargets();

            this.skipSceneHold = false;

            const holdMs = this.sceneFocus.getRecommendedHoldMs(this.config.sceneDelayMs);
            const holdOk = await this.wait(holdMs, token, { useSpeedScaling: false, allowSkip: true });
            if (!holdOk) {
                return false;
            }

            this.map.closeActivePopup();
            this.sceneFocus.close();

            const hasMore = this.state.advance();
            if (!hasMore) {
                return false;
            }

            const currentAfterAdvance = this.state.currentDay();
            if (!currentAfterAdvance || currentAfterAdvance.number !== day.number) {
                const outroOk = await this.wait(this.config.chapterOutroDelayMs, token);
                if (!outroOk) {
                    return false;
                }
            }

            return true;
        }

        openLocationFromSidebar(locationId) {
            if (this.state.isPlaying) {
                return;
            }

            const entry = this.map.markerByLocationId.get(locationId);
            if (!entry) {
                return;
            }

            this.openManualEntry(entry, 1.4, false);
        }

        handleMarkerClick(day, location) {
            if (this.state.isPlaying) {
                return;
            }

            this.applyManualFilter(day.number);
            this.hasManualFocus = true;
            this.currentManualLocationId = location.id;
            this.map.setActiveMarker(location.id);
            this.ui.activateDay(day.number);
            this.ui.activateLocation(location.id);
            this.ui.setPlaybackMode(PLAYBACK_MODE.MANUAL_BROWSE);
            this.ui.setNowViewing(`Now Viewing: Day ${day.number} - ${location.title}`);
            const sceneIndex = Math.max(0, day.locations.findIndex((loc) => loc.id === location.id)) + 1;
            this.sceneFocus.updateScene(day.number, location, sceneIndex, day.locations.length, false);
        }

        openSceneFocusFromPopup(locationId) {
            if (this.state.isPlaying) {
                return;
            }

            const entry = this.map.markerByLocationId.get(Number(locationId));
            if (!entry) {
                return;
            }

            const day = this.state.days.find((item) => item.number === entry.dayNumber);
            const total = day ? day.locations.length : 1;
            const idx = day ? Math.max(0, day.locations.findIndex((loc) => loc.id === entry.location.id)) : 0;
            this.sceneFocus.updateScene(entry.dayNumber, entry.location, idx + 1, total, true);
        }

        skipTravel() {
            if (!this.state.isPlaying || !this.canSkipTravel) {
                return;
            }

            if (!this.map.skipBusTravel()) {
                return;
            }

            this.updateTourControls(true);
        }
    }

    function boot(options) {
        const merged = { ...DEFAULT_CONFIG, ...(options || {}) };
        const daysDataElement = document.getElementById("days-data");
        const daysData = daysDataElement ? JSON.parse(daysDataElement.textContent) : [];

        const setupImageModal = () => {
            const modal = document.getElementById("map-image-modal");
            const image = document.getElementById("map-image-modal-img");
            const caption = document.getElementById("map-image-modal-caption");
            const counter = document.getElementById("map-image-modal-counter");
            const thumbnails = document.getElementById("map-image-modal-thumbnails");
            const closeButton = document.getElementById("map-image-modal-close");
            const prevButton = document.getElementById("map-image-modal-prev");
            const nextButton = document.getElementById("map-image-modal-next");

            if (!modal || !image || !caption || !counter || !thumbnails || !closeButton || !prevButton || !nextButton) {
                return;
            }

            let activeGallery = [];
            let activeIndex = 0;

            const syncThumbnailAlignment = () => {
                const hasOverflow = thumbnails.scrollWidth > thumbnails.clientWidth + 2;
                thumbnails.classList.toggle("thumbs-centered", !hasOverflow);
                if (hasOverflow) {
                    thumbnails.scrollLeft = 0;
                }
            };

            const updateNavState = () => {
                const hasPrev = activeIndex > 0;
                const hasNext = activeIndex < activeGallery.length - 1;
                prevButton.disabled = !hasPrev;
                nextButton.disabled = !hasNext;
                prevButton.style.opacity = hasPrev ? "1" : "0.45";
                nextButton.style.opacity = hasNext ? "1" : "0.45";
                prevButton.style.cursor = hasPrev ? "pointer" : "not-allowed";
                nextButton.style.cursor = hasNext ? "pointer" : "not-allowed";

                const thumbnailButtons = Array.from(thumbnails.querySelectorAll("[data-thumb-index]"));
                thumbnailButtons.forEach((button) => {
                    const index = Number(button.getAttribute("data-thumb-index"));
                    const isActive = index === activeIndex;
                    button.classList.toggle("is-active", isActive);
                });
            };

            const renderThumbnails = () => {
                thumbnails.innerHTML = activeGallery
                    .map(
                        (item, index) => `
                            <button type="button" data-thumb-index="${index}" class="modal-gallery-thumb inline-flex h-14 w-20 flex-none overflow-hidden rounded-lg bg-white/10">
                                <img src="${MapController.escapeHtml(item.src || "")}" alt="${MapController.escapeHtml(item.alt || "Location gallery image")}" class="h-full w-full object-cover" />
                            </button>
                        `
                    )
                    .join("");
                syncThumbnailAlignment();
            };

            const renderCurrent = () => {
                const current = activeGallery[activeIndex];
                if (!current) {
                    return;
                }
                image.src = current.src;
                image.alt = current.alt || "Location gallery image";
                caption.textContent = current.alt || "Location gallery image";
                counter.textContent = `${activeIndex + 1}/${activeGallery.length}`;
                updateNavState();
            };

            const moveBy = (offset) => {
                const nextIdx = activeIndex + offset;
                if (nextIdx < 0 || nextIdx >= activeGallery.length) {
                    return;
                }
                activeIndex = nextIdx;
                renderCurrent();
            };

            const closeModal = () => {
                modal.classList.add("hidden");
                modal.classList.remove("flex");
                image.src = "";
                image.alt = "Location gallery image";
                caption.textContent = "";
                counter.textContent = "";
                thumbnails.innerHTML = "";
                thumbnails.classList.remove("thumbs-centered");
                activeGallery = [];
                activeIndex = 0;
            };

            const openModal = (gallery, initialIndex) => {
                if (!gallery.length) {
                    return;
                }
                activeGallery = gallery;
                activeIndex = initialIndex;
                renderThumbnails();
                renderCurrent();
                modal.classList.remove("hidden");
                modal.classList.add("flex");
                window.requestAnimationFrame(syncThumbnailAlignment);
            };

            document.addEventListener("click", (event) => {
                const trigger = event.target.closest(".tour-popup-gallery-trigger");
                if (!trigger) {
                    return;
                }
                event.preventDefault();
                const popupRoot = trigger.closest(".leaflet-popup-content");
                const triggers = popupRoot
                    ? Array.from(popupRoot.querySelectorAll(".tour-popup-gallery-trigger"))
                    : [trigger];
                const gallery = triggers.map((item) => ({
                    src: item.getAttribute("data-full-src"),
                    alt: item.getAttribute("data-alt"),
                }));
                const initialIndex = Math.max(0, triggers.indexOf(trigger));
                openModal(gallery, initialIndex);
            });

            closeButton.addEventListener("click", closeModal);
            prevButton.addEventListener("click", () => moveBy(-1));
            nextButton.addEventListener("click", () => moveBy(1));
            thumbnails.addEventListener("click", (event) => {
                const thumbButton = event.target.closest("[data-thumb-index]");
                if (!thumbButton) {
                    return;
                }
                const index = Number(thumbButton.getAttribute("data-thumb-index"));
                if (!Number.isInteger(index) || index < 0 || index >= activeGallery.length) {
                    return;
                }
                activeIndex = index;
                renderCurrent();
            });
            modal.addEventListener("click", (event) => {
                if (event.target === modal) {
                    closeModal();
                }
            });

            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && !modal.classList.contains("hidden")) {
                    closeModal();
                }
                if (!modal.classList.contains("hidden") && event.key === "ArrowLeft") {
                    moveBy(-1);
                }
                if (!modal.classList.contains("hidden") && event.key === "ArrowRight") {
                    moveBy(1);
                }
            });

            window.addEventListener("resize", () => {
                if (!modal.classList.contains("hidden")) {
                    syncThumbnailAlignment();
                }
            });
        };

        setupImageModal();

        const stateManager = new TourStateManager(daysData);
        const mapController = new MapController("tour-map", merged);
        const uiController = new UIController();
        const sceneFocusController = new SceneFocusController(uiController);
        const playbackController = new PlaybackController(stateManager, mapController, uiController, sceneFocusController, merged);

        mapController.build(stateManager.days, (day, location) => playbackController.handleMarkerClick(day, location));

        uiController.bindControls({
            onPlay: () => playbackController.playTour(),
            onPause: () => playbackController.pauseTour(),
            onStop: () => playbackController.stopTour(),
            onSkipTravel: () => playbackController.skipTravel(),
            onPrev: () => playbackController.browseStep(-1),
            onNext: () => playbackController.browseStep(1),
            onFocusReopen: () => sceneFocusController.reopen(),
            onFocusFinish: () => playbackController.finishSceneFocus(),
        });

        uiController.bindSpeedControl((speed) => playbackController.updateSpeed(speed));

        uiController.bindFilters((day) => playbackController.applyManualFilter(day));
        uiController.bindLocationCards((locationId) => playbackController.openLocationFromSidebar(locationId));

        document.addEventListener("click", (event) => {
            const learnMoreButton = event.target.closest(".tour-popup-learn-more");
            if (!learnMoreButton) {
                return;
            }

            event.preventDefault();
            const locationId = Number(learnMoreButton.getAttribute("data-location-id"));
            if (!Number.isInteger(locationId)) {
                return;
            }

            playbackController.openSceneFocusFromPopup(locationId);
        });

        document.addEventListener("keydown", (event) => {
            if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
                return;
            }
            if (stateManager.isPlaying) {
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                playbackController.browseStep(-1);
            }
            if (event.key === "ArrowDown") {
                event.preventDefault();
                playbackController.browseStep(1);
            }
        });

        uiController.setControls({ isPlaying: false, isPaused: false, canSkipTravel: false });
        uiController.setPlaybackMode(PLAYBACK_MODE.STANDBY);
        uiController.setNowViewing("Now Viewing: Waiting To Start");
        playbackController.applyManualFilter("all");
        playbackController.syncBrowseTargets();

        window.addEventListener("load", () => {
            setTimeout(() => mapController.map.invalidateSize(), 120);
        });

        return {
            stateManager,
            mapController,
            uiController,
            sceneFocusController,
            playbackController,
        };
    }

    window.TourPlaybackEngine = {
        boot,
    };
})();
