(() => {
    const CONFIG = {
        defaultCenter: [14.5995, 120.9842],
        defaultZoom: 6,
        dayOverviewZoom: 10,
        locationZoom: 15,
        transitionDuration: 2.4,
        transitionZoomOutDuration: 1.6,
        introDelayMs: 900,
        sceneDelayMs: 1250,
        chapterOutroDelayMs: 750,
        routeProvider: "osrm",
        osrmBaseUrl: "https://router.project-osrm.org",
        openRouteServiceApiKey: "",
        routeLineColor: "#10b981",
        routeLineWeight: 4,
        busIconUrl: "",
        busBaseSpeedMetersPerSecond: 12,
    };

    const truncate = (text, maxLength = 120) => {
        if (!text) {
            return "";
        }
        if (text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength - 1)}…`;
    };

    const normalizeDays = (days) => {
        if (!Array.isArray(days)) {
            return [];
        }

        return days
            .map((day) => ({
                number: Number(day.number),
                title: day.title || "",
                locations: Array.isArray(day.locations)
                    ? day.locations
                        .map((loc) => ({
                            id: Number(loc.id),
                            title: loc.title || "Untitled location",
                            description: loc.description || "",
                            reflection: loc.reflection || "",
                            latitude: Number(loc.latitude),
                            longitude: Number(loc.longitude),
                            order: Number(loc.order ?? 0),
                            image_urls: Array.isArray(loc.image_urls) ? loc.image_urls : [],
                        }))
                        .filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude))
                        .sort((a, b) => a.order - b.order || a.id - b.id)
                    : [],
            }))
            .sort((a, b) => a.number - b.number);
    };

    const buildDayFilters = () => {
        const container = document.getElementById("day-filter-controls");
        if (!container) {
            return;
        }
        const fragment = document.createDocumentFragment();
        for (let i = 1; i <= 6; i += 1) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "day-filter-btn rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50";
            button.dataset.day = String(i);
            button.textContent = `Day ${i}`;
            fragment.appendChild(button);
        }
        container.appendChild(fragment);
    };

    const buildLocationsPanel = (days) => {
        const panel = document.getElementById("locations-panel");
        if (!panel) {
            return;
        }

        if (!days.length) {
            panel.innerHTML = "<div class=\"rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700\">No days found. Add Day 1-7 from the CMS dashboard to populate this map.</div>";
            return;
        }

        panel.innerHTML = days
            .map((day) => {
                const locations = Array.isArray(day.locations) ? day.locations : [];
                const locationCards = locations
                    .map((location) => `
                        <div class="location-card cursor-pointer rounded-xl border border-transparent bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/60 hover:shadow-md" data-location-id="${location.id}" data-day="${day.number}" data-order="${location.order}" data-title="${location.title}" data-id="${location.id}" data-lat="${location.latitude}" data-lng="${location.longitude}">
                            <div class="flex items-start justify-between gap-2">
                                <h4 class="min-w-0 flex-1 pr-2 text-sm font-semibold leading-snug text-gray-900">${location.title}</h4>
                                <span class="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Activity ${location.order + 1}</span>
                            </div>
                            <p class="mt-1 text-xs leading-relaxed text-gray-600">${truncate(location.description)}</p>
                            ${location.reflection ? `<p class=\"mt-1.5 text-xs italic leading-relaxed text-gray-500\">${truncate(location.reflection)}</p>` : ""}
                        </div>
                    `)
                    .join("");

                return `
                    <article class="day-section mb-3 overflow-hidden rounded-xl border border-emerald-100 bg-white/90 shadow-sm transition" data-day-section="${day.number}" data-day-title="${day.title}" data-accordion-open="false">
                        <button type="button" class="day-accordion-toggle flex w-full items-center justify-between gap-3 bg-emerald-50/70 px-4 py-3 text-left transition hover:bg-emerald-50" data-accordion-toggle aria-expanded="false">
                            <span class="block">
                                <span class="text-sm font-semibold leading-tight text-gray-900 sm:text-[15px]">Day ${day.number}${day.title ? `: ${day.title}` : ""}</span>
                            </span>
                            <svg class="day-chevron h-4 w-4 shrink-0 text-emerald-700 transition-transform duration-200" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z" clip-rule="evenodd"></path>
                            </svg>
                        </button>

                        <div class="day-accordion-panel" data-accordion-panel>
                            <div class="day-accordion-inner">
                                <div class="space-y-2.5 p-3 pt-2.5">
                                    ${locationCards || "<p class=\"day-empty-state text-sm text-gray-500\">No locations added for this day yet.</p>"}
                                </div>
                            </div>
                        </div>
                    </article>
                `;
            })
            .join("");
    };

    const insertDaysData = (days) => {
        let script = document.getElementById("days-data");
        if (!script) {
            script = document.createElement("script");
            script.id = "days-data";
            script.type = "application/json";
            document.body.appendChild(script);
        }
        script.textContent = JSON.stringify(days);
    };

    const setupSidebar = () => {
        const sidebar = document.getElementById("sidebar-shell");
        const openBtn = document.getElementById("sidebar-toggle");
        const closeBtn = document.getElementById("sidebar-close");

        if (!sidebar || !openBtn || !closeBtn) {
            return;
        }

        const open = () => {
            sidebar.classList.remove("-translate-x-[110%]");
        };

        const close = () => {
            sidebar.classList.add("-translate-x-[110%]");
        };

        openBtn.addEventListener("click", open);
        closeBtn.addEventListener("click", close);
        window.addEventListener("resize", () => {
            if (window.innerWidth >= 1024) {
                sidebar.classList.remove("-translate-x-[110%]");
            } else {
                sidebar.classList.add("-translate-x-[110%]");
            }
        });
    };

    const setupDayAccordion = () => {
        const daySections = Array.from(document.querySelectorAll(".day-section"));
        if (!daySections.length) {
            return;
        }

        const getToggle = (section) => section.querySelector("[data-accordion-toggle]");

        const setOpen = (section, shouldOpen) => {
            const toggle = getToggle(section);
            if (!toggle) {
                return;
            }

            section.dataset.accordionOpen = shouldOpen ? "true" : "false";
            toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
            section.classList.toggle("day-open", shouldOpen);
        };

        const openSingle = (targetSection) => {
            for (const section of daySections) {
                setOpen(section, section === targetSection);
            }
        };

        const closeAll = () => {
            for (const section of daySections) {
                setOpen(section, false);
            }
        };

        for (const section of daySections) {
            const toggle = getToggle(section);
            if (!toggle) {
                continue;
            }

            toggle.addEventListener("click", () => {
                const isOpen = section.dataset.accordionOpen === "true";
                if (isOpen) {
                    setOpen(section, false);
                    return;
                }
                openSingle(section);
            });
        }

        window.openTourDayAccordion = (dayNumber) => {
            if (dayNumber === "all" || dayNumber === undefined || dayNumber === null) {
                closeAll();
                return;
            }

            const target = document.querySelector(`[data-day-section="${dayNumber}"]`);
            if (!target || target.classList.contains("hidden")) {
                closeAll();
                return;
            }

            openSingle(target);
        };

        document.addEventListener("click", (event) => {
            const card = event.target.closest(".location-card");
            if (!card) {
                return;
            }

            const parentDay = card.closest(".day-section");
            if (parentDay) {
                openSingle(parentDay);
            }
        });

        closeAll();
    };

    const boot = async () => {
        const chapterStatus = document.getElementById("chapter-status");
        const nowViewing = document.getElementById("now-viewing");

        try {
            const response = await fetch("data/tour.json", { cache: "no-store" });
            if (!response.ok) {
                throw new Error("Failed to load tour data.");
            }
            const data = await response.json();
            const days = normalizeDays(data?.days || []);

            buildDayFilters();
            buildLocationsPanel(days);
            insertDaysData(days);
            setupSidebar();
            setupDayAccordion();

            if (!window.TourPlaybackEngine || typeof window.TourPlaybackEngine.boot !== "function") {
                throw new Error("Tour playback engine is unavailable.");
            }

            window.TourPlaybackEngine.boot(CONFIG);
        } catch (error) {
            console.error(error);
            if (chapterStatus) {
                chapterStatus.textContent = "Initialization Failed";
            }
            if (nowViewing) {
                nowViewing.textContent = "Now Viewing: Tour data could not be loaded.";
            }
            const panel = document.getElementById("locations-panel");
            if (panel) {
                panel.innerHTML = "<div class=\"rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700\">No days found. Add Day 1-7 from the CMS dashboard to populate this map.</div>";
            }
        }
    };

    boot();
})();
