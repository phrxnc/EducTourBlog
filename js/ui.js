const escapeHtml = (text) => String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const createUI = () => {
    const dayFilterControls = document.getElementById("day-filter-controls");
    const locationsPanel = document.getElementById("locations-panel");
    const globalEmptyState = document.getElementById("global-empty-state");
    const chapterStatus = document.getElementById("chapter-status");
    const nowViewing = document.getElementById("now-viewing");
    const speedControlValue = document.getElementById("speed-control-value");
    const dataError = document.getElementById("data-error");

    const sceneModal = document.getElementById("scene-focus-modal");
    const sceneTitle = document.getElementById("scene-focus-title");
    const sceneMeta = document.getElementById("scene-focus-meta");
    const sceneDescription = document.getElementById("scene-focus-description");
    const sceneReflection = document.getElementById("scene-focus-reflection");
    const sceneHeroImg = document.getElementById("scene-focus-hero-img");
    const sceneImageCounter = document.getElementById("scene-focus-image-counter");
    const sceneThumbnails = document.getElementById("scene-focus-thumbnails");
    const sceneClose = document.getElementById("scene-focus-close");
    const scenePrevImg = document.getElementById("scene-focus-prev-img");
    const sceneNextImg = document.getElementById("scene-focus-next-img");

    const mapImageModal = document.getElementById("map-image-modal");
    const mapImageModalImg = document.getElementById("map-image-modal-img");
    const mapImageModalCaption = document.getElementById("map-image-modal-caption");
    const mapImageModalCounter = document.getElementById("map-image-modal-counter");
    const mapImageModalThumbnails = document.getElementById("map-image-modal-thumbnails");
    const mapImageModalClose = document.getElementById("map-image-modal-close");
    const mapImageModalPrev = document.getElementById("map-image-modal-prev");
    const mapImageModalNext = document.getElementById("map-image-modal-next");

    let activeDayFilter = "all";
    let activeSceneImages = [];
    let activeSceneIndex = 0;
    let sceneAutoplayTimer = null;
    let sceneCloseTimer = null;
    let lastFocusedElement = null;
    let activeModalImages = [];
    let activeModalIndex = 0;

    const buildDayFilters = (days) => {
        if (!dayFilterControls) {
            return;
        }
        const buttons = [
            {
                label: "All Days",
                value: "all",
            },
            ...days.map((day) => ({
                label: `Day ${day.number}`,
                value: String(day.number),
            })),
        ];

        dayFilterControls.innerHTML = buttons
            .map((button) => {
                const isActive = button.value === "all";
                return `
                    <button type="button" class="day-filter-btn rounded-full border ${isActive ? "border-emerald-300 bg-emerald-600 text-white" : "border-emerald-200 bg-white text-emerald-800"} px-3 py-1.5 text-xs font-semibold transition hover:border-emerald-300 hover:bg-emerald-50" data-day="${button.value}">${escapeHtml(button.label)}</button>
                `;
            })
            .join("");
    };

    const buildLocationsPanel = (days) => {
        if (!locationsPanel) {
            return;
        }
        if (!days.length) {
            locationsPanel.innerHTML = "<div class=\"rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700\">No days found. Add data to data/tour.json to populate this map.</div>";
            return;
        }

        locationsPanel.innerHTML = days
            .map((day) => {
                const locations = Array.isArray(day.locations) ? day.locations : [];
                const locationCards = locations
                    .map((location, idx) => `
                        <div class="location-card cursor-pointer rounded-xl border border-transparent bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/60 hover:shadow-md" data-location-id="${escapeHtml(location.id)}" data-day="${escapeHtml(day.number)}" data-order="${escapeHtml(location.order)}" data-title="${escapeHtml(location.title)}" data-lat="${escapeHtml(location.latitude)}" data-lng="${escapeHtml(location.longitude)}">
                            <div class="flex items-start justify-between gap-2">
                                <h4 class="min-w-0 flex-1 pr-2 text-sm font-semibold leading-snug text-gray-900">${escapeHtml(location.title)}</h4>
                                <span class="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Activity ${idx + 1}</span>
                            </div>
                            <p class="mt-1 text-xs leading-relaxed text-gray-600">${escapeHtml(location.description || "")}</p>
                            ${location.reflection ? `<p class=\"mt-1.5 text-xs italic leading-relaxed text-gray-500\">${escapeHtml(location.reflection)}</p>` : ""}
                        </div>
                    `)
                    .join("");

                return `
                    <article class="day-section mb-3 overflow-hidden rounded-xl border border-emerald-100 bg-white/90 shadow-sm transition" data-day-section="${escapeHtml(day.number)}" data-day-title="${escapeHtml(day.title || "")}" data-accordion-open="false">
                        <button type="button" class="day-accordion-toggle flex w-full items-center justify-between gap-3 bg-emerald-50/70 px-4 py-3 text-left transition hover:bg-emerald-50" data-accordion-toggle aria-expanded="false">
                            <span class="block">
                                <span class="text-sm font-semibold leading-tight text-gray-900 sm:text-[15px]">Day ${escapeHtml(day.number)}${day.title ? `: ${escapeHtml(day.title)}` : ""}</span>
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

    const setDayFilterActive = (dayValue) => {
        activeDayFilter = String(dayValue);
        document.querySelectorAll(".day-filter-btn").forEach((button) => {
            const isActive = button.getAttribute("data-day") === activeDayFilter;
            button.classList.toggle("bg-emerald-600", isActive);
            button.classList.toggle("text-white", isActive);
            button.classList.toggle("border-emerald-300", isActive);
            button.classList.toggle("bg-white", !isActive);
            button.classList.toggle("text-emerald-800", !isActive);
            button.classList.toggle("border-emerald-200", !isActive);
        });
    };

    const filterDaySections = (dayValue) => {
        const target = String(dayValue);
        let visibleCount = 0;
        document.querySelectorAll(".day-section").forEach((section) => {
            const sectionDay = section.getAttribute("data-day-section");
            const shouldShow = target === "all" || target === sectionDay;
            section.classList.toggle("hidden", !shouldShow);
            if (shouldShow) {
                visibleCount += 1;
            }
        });
        if (globalEmptyState) {
            globalEmptyState.classList.toggle("hidden", visibleCount > 0);
        }
    };

    const bindAccordion = () => {
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
            daySections.forEach((section) => setOpen(section, section === targetSection));
        };
        daySections.forEach((section) => {
            const toggle = getToggle(section);
            if (!toggle) {
                return;
            }
            toggle.addEventListener("click", () => {
                const isOpen = section.dataset.accordionOpen === "true";
                setOpen(section, !isOpen);
            });
        });
    };

    const setPlaybackStatus = (status, nowText) => {
        if (chapterStatus) {
            chapterStatus.textContent = status;
        }
        if (nowViewing) {
            nowViewing.textContent = nowText;
        }
    };

    const setSpeedValue = (value) => {
        if (speedControlValue) {
            speedControlValue.textContent = `${Number(value).toFixed(1)}x`;
        }
    };

    const showDataError = (message) => {
        if (!dataError) {
            return;
        }
        dataError.textContent = message;
        dataError.classList.remove("hidden");
    };

    const hideDataError = () => {
        if (!dataError) {
            return;
        }
        dataError.classList.add("hidden");
        dataError.textContent = "";
    };

    const syncThumbnailAlignment = (container) => {
        const hasOverflow = container.scrollWidth > container.clientWidth + 2;
        container.classList.toggle("thumbs-centered", !hasOverflow);
        if (hasOverflow) {
            container.scrollLeft = 0;
        }
    };

    const stopSceneAutoplay = () => {
        if (sceneAutoplayTimer) {
            window.clearInterval(sceneAutoplayTimer);
            sceneAutoplayTimer = null;
        }
    };

    const startSceneAutoplay = () => {
        stopSceneAutoplay();
        if (activeSceneImages.length <= 1) {
            return;
        }
        sceneAutoplayTimer = window.setInterval(() => {
            if (!sceneModal || !sceneModal.classList.contains("is-visible")) {
                return;
            }
            if (activeSceneIndex >= activeSceneImages.length - 1) {
                stopSceneAutoplay();
                closeSceneFocus();
                return;
            }
            activeSceneIndex = Math.min(activeSceneImages.length - 1, activeSceneIndex + 1);
            renderSceneImage();
        }, 2600);
    };

    const restartSceneAutoplay = () => {
        stopSceneAutoplay();
        startSceneAutoplay();
    };

    const setSceneFocusImages = (images) => {
        activeSceneImages = images || [];
        activeSceneIndex = 0;

        if (!sceneThumbnails) {
            return;
        }

        sceneThumbnails.innerHTML = activeSceneImages
            .map(
                (src, index) => `
                    <button type="button" data-scene-thumb-index="${index}" class="scene-focus-thumb inline-flex h-14 w-20 flex-none overflow-hidden rounded-lg bg-white" aria-label="Show image ${index + 1}">
                        <img src="${escapeHtml(src)}" alt="Location image ${index + 1}" class="h-full w-full object-cover" />
                    </button>
                `
            )
            .join("");

        syncThumbnailAlignment(sceneThumbnails);
    };

    const renderSceneImage = () => {
        if (!activeSceneImages.length) {
            if (sceneHeroImg) {
                sceneHeroImg.src = "";
                sceneHeroImg.alt = "";
            }
            if (sceneImageCounter) {
                sceneImageCounter.textContent = "0/0";
            }
            return;
        }
        const current = activeSceneImages[activeSceneIndex];
        if (sceneHeroImg) {
            sceneHeroImg.src = current;
            sceneHeroImg.alt = "Itinerary image";
        }
        if (sceneImageCounter) {
            sceneImageCounter.textContent = `${activeSceneIndex + 1}/${activeSceneImages.length}`;
        }
        if (sceneThumbnails) {
            sceneThumbnails.querySelectorAll("[data-scene-thumb-index]").forEach((thumb) => {
                const idx = Number(thumb.getAttribute("data-scene-thumb-index"));
                thumb.classList.toggle("is-active", idx === activeSceneIndex);
            });
        }
    };

    const openSceneFocus = (dayNumber, location, index, total) => {
        if (!sceneModal) {
            return;
        }
        const images = Array.isArray(location.image_urls) ? location.image_urls : [];
        if (sceneTitle) {
            sceneTitle.textContent = location.title || "Itinerary Focus";
        }
        if (sceneMeta) {
            sceneMeta.textContent = `Day ${dayNumber} - Activity ${index}/${total}`;
        }
        if (sceneDescription) {
            sceneDescription.textContent = location.description || "";
            sceneDescription.classList.add("scene-focus-visible");
        }
        if (sceneReflection) {
            if (location.reflection) {
                sceneReflection.textContent = location.reflection;
                sceneReflection.classList.add("scene-focus-visible");
                sceneReflection.classList.remove("hidden");
            } else {
                sceneReflection.textContent = "";
                sceneReflection.classList.remove("scene-focus-visible");
                sceneReflection.classList.add("hidden");
            }
        }
        setSceneFocusImages(images);
        renderSceneImage();
        sceneModal.classList.remove("hidden");
        sceneModal.classList.add("flex");
        if (sceneCloseTimer) {
            window.clearTimeout(sceneCloseTimer);
            sceneCloseTimer = null;
        }
        lastFocusedElement = document.activeElement;
        void sceneModal.offsetWidth;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                sceneModal.classList.add("is-visible");
            });
        });

        window.setTimeout(() => sceneDescription?.classList.add("scene-focus-visible"), 500);
        if (sceneReflection && !sceneReflection.classList.contains("hidden")) {
            window.setTimeout(() => sceneReflection.classList.add("scene-focus-visible"), 800);
        }

        startSceneAutoplay();
    };

    const closeSceneFocus = () => {
        if (!sceneModal) {
            return;
        }
        sceneModal.classList.remove("is-visible");
        stopSceneAutoplay();
        if (sceneCloseTimer) {
            window.clearTimeout(sceneCloseTimer);
        }
        sceneCloseTimer = window.setTimeout(() => {
            sceneModal.classList.add("hidden");
            sceneModal.classList.remove("flex");
            sceneCloseTimer = null;
        }, 420);
        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus({ preventScroll: true });
        }
    };

    const openImageModal = (images, index = 0) => {
        activeModalImages = images || [];
        activeModalIndex = Math.max(0, Math.min(index, activeModalImages.length - 1));
        if (!mapImageModal || !mapImageModalImg) {
            return;
        }

        mapImageModal.classList.remove("hidden");
        mapImageModal.classList.add("flex");

        mapImageModalThumbnails.innerHTML = activeModalImages
            .map(
                (src, idx) => `
                    <button type="button" data-thumb-index="${idx}" class="modal-gallery-thumb inline-flex h-14 w-20 flex-none overflow-hidden rounded-lg bg-white/10">
                        <img src="${escapeHtml(src)}" alt="Location image ${idx + 1}" class="h-full w-full object-cover" />
                    </button>
                `
            )
            .join("");
        syncThumbnailAlignment(mapImageModalThumbnails);

        const renderModal = () => {
            const current = activeModalImages[activeModalIndex];
            mapImageModalImg.src = current;
            mapImageModalImg.alt = "Location gallery image";
            mapImageModalCaption.textContent = current ? "Location gallery image" : "";
            mapImageModalCounter.textContent = `${activeModalIndex + 1}/${activeModalImages.length}`;
            mapImageModalPrev.disabled = activeModalIndex === 0;
            mapImageModalNext.disabled = activeModalIndex >= activeModalImages.length - 1;
            mapImageModalThumbnails.querySelectorAll("[data-thumb-index]").forEach((thumb) => {
                const idx = Number(thumb.getAttribute("data-thumb-index"));
                thumb.classList.toggle("is-active", idx === activeModalIndex);
            });
        };

        renderModal();

        mapImageModalPrev.onclick = () => {
            activeModalIndex = Math.max(0, activeModalIndex - 1);
            renderModal();
        };
        mapImageModalNext.onclick = () => {
            activeModalIndex = Math.min(activeModalImages.length - 1, activeModalIndex + 1);
            renderModal();
        };
        mapImageModalThumbnails.onclick = (event) => {
            const button = event.target.closest("[data-thumb-index]");
            if (!button) {
                return;
            }
            activeModalIndex = Number(button.getAttribute("data-thumb-index"));
            renderModal();
        };
    };

    const closeImageModal = () => {
        if (!mapImageModal) {
            return;
        }
        mapImageModal.classList.add("hidden");
        mapImageModal.classList.remove("flex");
        if (mapImageModalImg) {
            mapImageModalImg.src = "";
        }
    };

    if (sceneClose) {
        sceneClose.addEventListener("click", closeSceneFocus);
    }
    if (scenePrevImg) {
        scenePrevImg.addEventListener("click", () => {
            activeSceneIndex = Math.max(0, activeSceneIndex - 1);
            renderSceneImage();
            restartSceneAutoplay();
        });
    }
    if (sceneNextImg) {
        sceneNextImg.addEventListener("click", () => {
            activeSceneIndex = Math.min(activeSceneImages.length - 1, activeSceneIndex + 1);
            renderSceneImage();
            restartSceneAutoplay();
        });
    }
    if (sceneThumbnails) {
        sceneThumbnails.addEventListener("click", (event) => {
            const button = event.target.closest("[data-scene-thumb-index]");
            if (!button) {
                return;
            }
            activeSceneIndex = Number(button.getAttribute("data-scene-thumb-index"));
            renderSceneImage();
            restartSceneAutoplay();
        });
    }
    if (sceneModal) {
        sceneModal.addEventListener("click", (event) => {
            if (event.target === sceneModal) {
                closeSceneFocus();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (!sceneModal || sceneModal.classList.contains("hidden")) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeSceneFocus();
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            activeSceneIndex = Math.max(0, activeSceneIndex - 1);
            renderSceneImage();
            stopSceneAutoplay();
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            activeSceneIndex = Math.min(activeSceneImages.length - 1, activeSceneIndex + 1);
            renderSceneImage();
            stopSceneAutoplay();
        }
    });
    if (mapImageModalClose) {
        mapImageModalClose.addEventListener("click", closeImageModal);
    }

    return {
        buildDayFilters,
        buildLocationsPanel,
        setDayFilterActive,
        filterDaySections,
        bindAccordion,
        setPlaybackStatus,
        setSpeedValue,
        showDataError,
        hideDataError,
        openSceneFocus,
        closeSceneFocus,
        openImageModal,
        closeImageModal,
        escapeHtml,
    };
};
