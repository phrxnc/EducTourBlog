const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createPlaybackController = ({ mapController, ui, config, onLocationChange, onStateChange }) => {
    let days = [];
    let dayIndex = 0;
    let locationIndex = 0;
    let isPlaying = false;
    let isPaused = false;
    let token = 0;
    let activeAnimation = null;

    const reset = () => {
        dayIndex = 0;
        locationIndex = 0;
        isPlaying = false;
        isPaused = false;
        token += 1;
    };

    const emitState = (state) => {
        if (onStateChange) {
            onStateChange(state, { isPlaying, isPaused });
        }
    };

    const setDays = (nextDays) => {
        days = nextDays || [];
    };

    const currentDay = () => days[dayIndex] || null;

    const currentLocation = () => {
        const day = currentDay();
        if (!day) {
            return null;
        }
        return day.locations[locationIndex] || null;
    };

    const nextLocation = () => {
        const day = currentDay();
        if (!day) {
            return null;
        }
        if (locationIndex + 1 < day.locations.length) {
            return day.locations[locationIndex + 1];
        }
        const nextDay = days[dayIndex + 1];
        return nextDay ? nextDay.locations[0] : null;
    };

    const updateNowViewing = (day, location) => {
        if (!day || !location) {
            ui.setPlaybackStatus("Standby", "Now Viewing: Waiting to start");
            return;
        }
        ui.setPlaybackStatus("Tour Active", `Now Viewing: Day ${day.number} - ${location.title}`);
    };

    const showScene = (day, location) => {
        const idx = Math.max(0, day.locations.findIndex((loc) => loc.id === location.id)) + 1;
        ui.openSceneFocus(day.number, location, idx, day.locations.length);
    };

    const moveToLocation = (day, location) => {
        mapController.setActiveMarker(location.id);
        mapController.flyToLocation(location, config.locationZoom);
        updateNowViewing(day, location);
        if (onLocationChange) {
            onLocationChange(day, location);
        }
    };

    const travelToNext = async (start, end, travelToken) => {
        if (!start || !end) {
            return true;
        }
        try {
            const route = await mapController.routeService.fetchRoute(
                mapController.toLngLat(start),
                mapController.toLngLat(end),
                {}
            );
            if (travelToken !== token) {
                return false;
            }
            activeAnimation = mapController.animateRoute(route, config.busBaseSpeedMetersPerSecond * config.speedMultiplier);
            await activeAnimation.promise;
            mapController.clearRoute();
            activeAnimation = null;
            return true;
        } catch (error) {
            if (travelToken !== token) {
                return false;
            }
            const fallbackRoute = [
                mapController.toLngLat(start),
                mapController.toLngLat(end),
            ];
            activeAnimation = mapController.animateRoute(
                fallbackRoute,
                config.busBaseSpeedMetersPerSecond * config.speedMultiplier
            );
            await activeAnimation.promise;
            mapController.clearRoute();
            activeAnimation = null;
            return true;
        }
    };

    const playLoop = async (loopToken) => {
        if (!days.length) {
            return;
        }
        ui.setPlaybackStatus("Tour Active", "Now Viewing: Preparing tour");
        while (loopToken === token && dayIndex < days.length) {
            const day = currentDay();
            if (!day || !day.locations.length) {
                dayIndex += 1;
                locationIndex = 0;
                continue;
            }

            const location = currentLocation();
            if (!location) {
                dayIndex += 1;
                locationIndex = 0;
                continue;
            }

            moveToLocation(day, location);
            showScene(day, location);

            await sleep(config.sceneDelayMs / config.speedMultiplier);

            if (loopToken !== token) {
                return;
            }

            while (isPaused && loopToken === token) {
                ui.setPlaybackStatus("Paused", `Now Viewing: Day ${day.number} - ${location.title}`);
                await sleep(200);
            }

            const next = nextLocation();
            if (!next) {
                break;
            }

            ui.closeSceneFocus();

            const traveled = await travelToNext(location, next, loopToken);
            if (!traveled || loopToken !== token) {
                return;
            }

            if (locationIndex + 1 < day.locations.length) {
                locationIndex += 1;
            } else {
                dayIndex += 1;
                locationIndex = 0;
            }
        }

        isPlaying = false;
        isPaused = false;
        ui.setPlaybackStatus("Tour Completed", "Now Viewing: Tour finished");
        emitState("completed");
    };

    const start = () => {
        if (isPlaying) {
            return;
        }
        if (!days.length) {
            ui.setPlaybackStatus("No Data", "Now Viewing: Add locations to start the tour.");
            return;
        }
        reset();
        isPlaying = true;
        isPaused = false;
        emitState("playing");
        const loopToken = token;
        playLoop(loopToken);
    };

    const pause = () => {
        if (!isPlaying) {
            return;
        }
        isPaused = !isPaused;
        emitState(isPaused ? "paused" : "playing");
        if (!isPaused) {
            ui.setPlaybackStatus("Tour Active", "Now Viewing: Resuming tour");
        }
    };

    const stop = () => {
        if (activeAnimation) {
            activeAnimation.cancel();
            activeAnimation = null;
        }
        reset();
        ui.setPlaybackStatus("Standby", "Now Viewing: Waiting to start");
        emitState("idle");
    };

    const skipTravel = () => {
        if (activeAnimation) {
            activeAnimation.skip();
        }
    };

    const goNext = () => {
        const day = currentDay();
        if (!day) {
            return;
        }
        if (locationIndex + 1 < day.locations.length) {
            locationIndex += 1;
        } else if (dayIndex + 1 < days.length) {
            dayIndex += 1;
            locationIndex = 0;
        }
        const location = currentLocation();
        if (location) {
            moveToLocation(currentDay(), location);
            showScene(currentDay(), location);
        }
    };

    const goPrev = () => {
        if (locationIndex > 0) {
            locationIndex -= 1;
        } else if (dayIndex > 0) {
            dayIndex -= 1;
            locationIndex = Math.max(0, (currentDay()?.locations?.length || 1) - 1);
        }
        const location = currentLocation();
        if (location) {
            moveToLocation(currentDay(), location);
            showScene(currentDay(), location);
        }
    };

    return {
        setDays,
        start,
        pause,
        stop,
        skipTravel,
        goNext,
        goPrev,
    };
};
