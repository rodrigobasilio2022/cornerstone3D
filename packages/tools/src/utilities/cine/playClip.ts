import { glMatrix, vec3 } from 'gl-matrix';
import {
  utilities as csUtils,
  getEnabledElement,
  StackViewport,
  VideoViewport,
  VolumeViewport,
  cache,
  BaseVolumeViewport,
  Enums,
} from '@cornerstonejs/core';

import type { Types } from '@cornerstonejs/core';
import CINE_EVENTS from './events';
import { addToolState, getToolState, getToolStateByViewportId } from './state';
import type { CINETypes } from '../../types';

const { ViewportStatus } = Enums;
const { triggerEvent } = csUtils;

const debounced = true;
const dynamicVolumesPlayingMap = new Map();

type StopClipOptions = {
  stopDynamicCine: boolean;
  viewportId?: string;
};

/**
 * Starts playing a clip or adjusts the frame rate of an already playing clip.  framesPerSecond is
 * optional and defaults to 30 if not specified.  A negative framesPerSecond will play the clip in reverse.
 * The element must be a stack of images
 * @param element - HTML Element
 * @param framesPerSecond - Number of frames per second
 */
function playClip(
  element: HTMLDivElement,
  playClipOptions: CINETypes.PlayClipOptions
): void {
  let playClipTimeouts;
  let playClipIsTimeVarying;

  if (element === undefined) {
    throw new Error('playClip: element must not be undefined');
  }

  const enabledElement = getEnabledElement(element);

  if (!enabledElement) {
    throw new Error(
      'playClip: element must be a valid Cornerstone enabled element'
    );
  }

  if (!playClipOptions) {
    playClipOptions = {};
  }

  // 4D Cine is enabled by default
  playClipOptions.dynamicCineEnabled =
    playClipOptions.dynamicCineEnabled ?? true;

  const { viewport } = enabledElement;

  const playClipContext = _createCinePlayContext(viewport, playClipOptions);
  let playClipData = getToolState(element);

  const isDynamicCinePlaying = playClipOptions.dynamicCineEnabled;

  // If user is trying to play CINE for a 4D volume it first needs
  // to stop CINE that has may be playing for any other viewport.
  if (isDynamicCinePlaying) {
    _stopDynamicVolumeCine(element);
  }

  if (!playClipData) {
    playClipData = {
      intervalId: undefined,
      framesPerSecond: 30,
      lastFrameTimeStamp: undefined,
      ignoreFrameTimeVector: false,
      usingFrameTimeVector: false,
      frameTimeVector: playClipOptions.frameTimeVector ?? undefined,
      speed: playClipOptions.frameTimeVectorSpeedMultiplier ?? 1,
      reverse: playClipOptions.reverse ?? false,
      loop: playClipOptions.loop ?? true,
      bounce: playClipOptions.bounce ?? false,
    };
    addToolState(element, playClipData);
  } else {
    // Make sure the specified clip is not running before any property update.
    // If a 3D CINE was playing it passes isDynamicCinePlaying as FALSE to
    // prevent stopping a 4D CINE in case it is playing on another viewport.
    _stopClip(element, {
      stopDynamicCine: !isDynamicCinePlaying,
      viewportId: viewport.id,
    });
  }

  playClipData.dynamicCineEnabled = playClipOptions.dynamicCineEnabled;

  // If a framesPerSecond is specified and is valid, update the playClipData now
  if (
    playClipOptions.framesPerSecond < 0 ||
    playClipOptions.framesPerSecond > 0
  ) {
    playClipData.framesPerSecond = Number(playClipOptions.framesPerSecond);
    playClipData.reverse = playClipData.framesPerSecond < 0;
    // If framesPerSecond is given, frameTimeVector will be ignored...
    playClipData.ignoreFrameTimeVector = true;
  }

  // Determine if frame time vector should be used instead of a fixed frame rate...
  if (
    playClipData.ignoreFrameTimeVector !== true &&
    playClipData.frameTimeVector &&
    playClipData.frameTimeVector.length === playClipContext.numScrollSteps &&
    playClipContext.frameTimeVectorEnabled
  ) {
    const { timeouts, isTimeVarying } = _getPlayClipTimeouts(
      playClipData.frameTimeVector,
      playClipData.speed
    );

    playClipTimeouts = timeouts;
    playClipIsTimeVarying = isTimeVarying;
  }

  if (playClipOptions.bounce !== undefined) {
    playClipData.bounce = playClipOptions.bounce;
  }

  // This function encapsulates the frame rendering logic...
  const playClipAction = () => {
    const { numScrollSteps, currentStepIndex } = playClipContext;
    let newStepIndex = currentStepIndex + (playClipData.reverse ? -1 : 1);
    const outOfRange = newStepIndex < 0 || newStepIndex >= numScrollSteps;

    if (outOfRange) {
      if (playClipData.bounce) {
        playClipData.reverse = !playClipData.reverse;
        newStepIndex = currentStepIndex + (playClipData.reverse ? -1 : 1);

        newStepIndex = Math.max(0, Math.min(numScrollSteps - 1, newStepIndex));
      } else if (!playClipData.loop) {
        // If a 3D CINE was playing it passes isDynamicCinePlaying as FALSE to
        // prevent stopping a 4D CINE in case it is playing on another viewport.
        _stopClip(element, {
          stopDynamicCine: !isDynamicCinePlaying,
          viewportId: viewport.id,
        });

        triggerEvent(element, CINE_EVENTS.CLIP_STOPPED, { element });
        return;
      } else {
        newStepIndex = playClipData.reverse ? numScrollSteps - 1 : 0;
      }
    }

    const delta = newStepIndex - currentStepIndex;

    if (delta) {
      try {
        playClipContext.scroll(delta);
      } catch (e) {
        console.warn('Play clip not scrolling', e);
        _stopClipWithData(playClipData);
        triggerEvent(element, CINE_EVENTS.CLIP_STOPPED, { element });
      }
    }
  };

  if (isDynamicCinePlaying) {
    const volume = _getVolumeFromViewport(
      viewport as Types.IBaseVolumeViewport
    );

    if (volume) {
      dynamicVolumesPlayingMap.set(volume.volumeId, element);
    }
  }

  if (playClipContext.play) {
    playClipData.framesPerSecond = playClipContext.play(
      playClipOptions.framesPerSecond
    );

    // If playClipTimeouts array is available, not empty and its elements are NOT uniform ...
    // ... (at least one timeout is different from the others), use alternate setTimeout implementation
  } else if (
    playClipTimeouts &&
    playClipTimeouts.length > 0 &&
    playClipIsTimeVarying
  ) {
    playClipData.usingFrameTimeVector = true;
    playClipData.intervalId = window.setTimeout(
      function playClipTimeoutHandler() {
        playClipData.intervalId = window.setTimeout(
          playClipTimeoutHandler,
          playClipTimeouts[playClipContext.currentStepIndex]
        );
        playClipAction();
      },
      0
    );
  } else {
    // ... otherwise user setInterval implementation which is much more efficient.
    playClipData.usingFrameTimeVector = false;
    playClipData.intervalId = window.setInterval(
      playClipAction,
      1000 / Math.abs(playClipData.framesPerSecond)
    );
  }

  const eventDetail = {
    element,
  };

  triggerEvent(element, CINE_EVENTS.CLIP_STARTED, eventDetail);
}

/**
 * Stops an already playing clip.
 * @param element - HTML Element
 */
function stopClip(
  element: HTMLDivElement,
  options = {} as StopClipOptions
): void {
  _stopClip(element, {
    stopDynamicCine: true,
    ...options,
  });
}

function _stopClip(
  element: HTMLDivElement,
  options: StopClipOptions = { stopDynamicCine: true, viewportId: undefined }
) {
  const { stopDynamicCine, viewportId } = options;
  const enabledElement = getEnabledElement(element);

  let toolState;
  const viewport = enabledElement?.viewport;
  if (!enabledElement) {
    if (viewportId) {
      toolState = getToolStateByViewportId(viewportId);
    } else {
      return;
    }
  } else {
    const { viewport } = enabledElement;
    toolState = getToolState(viewport.element);
  }

  if (toolState) {
    _stopClipWithData(toolState);
  }

  if (viewport instanceof VideoViewport) {
    (viewport as Types.IVideoViewport).pause();
  } else if (stopDynamicCine && viewport instanceof BaseVolumeViewport) {
    _stopDynamicVolumeCine(element);
  }
}

/**
 * [private] Stops any CINE playing for the dynamic volume loaded on this viewport
 * @param element - HTML Element
 */
function _stopDynamicVolumeCine(element: HTMLDivElement) {
  const { viewport } = getEnabledElement(element);
  if (viewport instanceof VolumeViewport) {
    const volume = _getVolumeFromViewport(viewport);
    if (volume?.isDynamicVolume()) {
      const dynamicCineElement = dynamicVolumesPlayingMap.get(volume.volumeId);

      dynamicVolumesPlayingMap.delete(volume.volumeId);

      if (dynamicCineElement && dynamicCineElement !== element) {
        stopClip(<HTMLDivElement>dynamicCineElement);
      }
    }
  }

  // If the current viewport has a 4D volume loaded it may be playing
  // if it is also loaded on another viewport and user has started CINE
  // for that one. This guarantees the other viewport will also be stopped.
}

/**
 * [private] Turns a Frame Time Vector (0018,1065) array into a normalized array of timeouts. Each element
 * ... of the resulting array represents the amount of time each frame will remain on the screen.
 * @param vector - A Frame Time Vector (0018,1065) as specified in section C.7.6.5.1.2 of DICOM standard.
 * @param speed - A speed factor which will be applied to each element of the resulting array.
 * @returns An array with timeouts for each animation frame.
 */
function _getPlayClipTimeouts(vector: number[], speed: number) {
  let i;
  let sample;
  let delay;
  let sum = 0;
  const limit = vector.length;
  const timeouts = [];

  // Initialize time varying to false
  let isTimeVarying = false;

  if (typeof speed !== 'number' || speed <= 0) {
    speed = 1;
  }

  // First element of a frame time vector must be discarded
  for (i = 1; i < limit; i++) {
    // eslint-disable-next-line no-bitwise
    delay = (Number(vector[i]) / speed) | 0; // Integral part only
    timeouts.push(delay);
    if (i === 1) {
      // Use first item as a sample for comparison
      sample = delay;
    } else if (delay !== sample) {
      isTimeVarying = true;
    }

    sum += delay;
  }

  if (timeouts.length > 0) {
    if (isTimeVarying) {
      // If it's a time varying vector, make the last item an average...
      // eslint-disable-next-line no-bitwise
      delay = (sum / timeouts.length) | 0;
    } else {
      delay = timeouts[0];
    }

    timeouts.push(delay);
  }

  return { timeouts, isTimeVarying };
}

/**
 * [private] Performs the heavy lifting of stopping an ongoing animation.
 * @param element - HTML Element
 * @param playClipData - The data from playClip that needs to be stopped.
 */
function _stopClipWithData(playClipData) {
  const id = playClipData.intervalId;

  if (typeof id !== 'undefined') {
    playClipData.intervalId = undefined;
    if (playClipData.usingFrameTimeVector) {
      clearTimeout(id);
    } else {
      clearInterval(id);
    }
  }
}

function _getVolumeFromViewport(
  viewport: Types.IBaseVolumeViewport
): Types.IImageVolume {
  if (!(viewport instanceof VolumeViewport)) {
    return undefined;
  }

  const volumeIds = viewport.getAllVolumeIds();

  if (!volumeIds?.length) {
    return undefined;
  }

  const dynamicVolumeId = volumeIds.find((volumeId) =>
    cache.getVolume(volumeId)?.isDynamicVolume()
  );

  const volumeId = dynamicVolumeId ?? volumeIds[0];

  return cache.getVolume(volumeId);
}

function _createStackViewportCinePlayContext(
  viewport: StackViewport,
  waitForRendered: number
): CINETypes.CinePlayContext {
  const imageIds = viewport.getImageIds();

  return {
    get numScrollSteps(): number {
      return imageIds.length;
    },
    get currentStepIndex(): number {
      return viewport.getTargetImageIdIndex();
    },
    get frameTimeVectorEnabled(): boolean {
      // It is always in acquired orientation
      return true;
    },
    waitForRenderedCount: 0,
    scroll(delta: number): void {
      if (
        this.waitForRenderedCount <= waitForRendered &&
        viewport.viewportStatus !== ViewportStatus.RENDERED
      ) {
        this.waitForRenderedCount++;
        return;
      }
      this.waitForRenderedCount = 0;
      csUtils.scroll(viewport, { delta, debounceLoading: debounced });
    },
  };
}

function _createVideoViewportCinePlayContext(
  viewport: VideoViewport,
  waitForRendered: number
): CINETypes.CinePlayContext {
  return {
    get numScrollSteps(): number {
      return viewport.getNumberOfSlices();
    },
    get currentStepIndex(): number {
      return viewport.getSliceIndex();
    },
    get frameTimeVectorEnabled(): boolean {
      // It is always in acquired orientation
      return true;
    },
    waitForRenderedCount: 0,
    scroll(delta: number): void {
      if (
        this.waitForRenderedCount <= waitForRendered &&
        viewport.viewportStatus !== ViewportStatus.RENDERED
      ) {
        this.waitForRenderedCount++;
        return;
      }
      this.waitForRenderedCount = 0;
      csUtils.scroll(viewport, { delta, debounceLoading: debounced });
    },
    play(fps?: number): number {
      if (fps) {
        // This is a bit of a kludge to correspond to playback rates
        // for other viewports
        viewport.setPlaybackRate(fps / 24);
      }
      viewport.play();
      return viewport.getFrameRate();
    },
  };
}

function _createVolumeViewportCinePlayContext(
  viewport: VolumeViewport,
  volume: Types.IImageVolume
): CINETypes.CinePlayContext {
  const { volumeId } = volume;
  const cachedScrollInfo = {
    viewPlaneNormal: vec3.create(),
    scrollInfo: null,
  };

  const getScrollInfo = () => {
    const camera = viewport.getCamera();
    const updateCache =
      !cachedScrollInfo.scrollInfo ||
      !vec3.equals(camera.viewPlaneNormal, cachedScrollInfo.viewPlaneNormal);

    // Number of steps would change only after rotating the volume so it
    // caches the result and recomputes only when necessary. Until it is
    // rotated the current frame is updated locally
    if (updateCache) {
      const scrollInfo = csUtils.getVolumeViewportScrollInfo(
        viewport,
        volumeId
      );

      cachedScrollInfo.viewPlaneNormal = camera.viewPlaneNormal;
      cachedScrollInfo.scrollInfo = scrollInfo;
    }

    return cachedScrollInfo.scrollInfo;
  };

  return {
    get numScrollSteps(): number {
      return getScrollInfo().numScrollSteps;
    },
    get currentStepIndex(): number {
      return getScrollInfo().currentStepIndex;
    },
    get frameTimeVectorEnabled(): boolean {
      const camera = viewport.getCamera();
      const volumeViewPlaneNormal = volume.direction
        .slice(6, 9)
        .map((x) => -x) as Types.Point3;
      const dot = vec3.dot(volumeViewPlaneNormal, camera.viewPlaneNormal);

      // Check if the volume is in acquired orientation
      // it may be flipped or rotated in plane
      return glMatrix.equals(dot, 1);
    },
    scroll(delta: number): void {
      getScrollInfo().currentStepIndex += delta;
      csUtils.scroll(viewport, { delta });
    },
  };
}

function _createDynamicVolumeViewportCinePlayContext(
  volume: Types.IDynamicImageVolume
): CINETypes.CinePlayContext {
  return {
    get numScrollSteps(): number {
      return volume.numDimensionGroups;
    },
    get currentStepIndex(): number {
      // Convert 1-based dimensionGroupNumber to 0-based index for consistency
      return volume.dimensionGroupNumber - 1;
    },
    get frameTimeVectorEnabled(): boolean {
      // Looping though time does not uses frameTimeVector
      return false;
    },
    scroll(delta: number): void {
      volume.scroll(delta);
    },
  };
}

function _createCinePlayContext(
  viewport,
  playClipOptions: CINETypes.PlayClipOptions
): CINETypes.CinePlayContext {
  if (viewport instanceof StackViewport) {
    return _createStackViewportCinePlayContext(
      viewport,
      playClipOptions.waitForRendered ?? 30
    );
  }

  if (viewport instanceof VolumeViewport) {
    const volume = _getVolumeFromViewport(viewport);

    if (playClipOptions.dynamicCineEnabled && volume?.isDynamicVolume()) {
      return _createDynamicVolumeViewportCinePlayContext(
        <Types.IDynamicImageVolume>volume
      );
    }

    return _createVolumeViewportCinePlayContext(viewport, volume);
  }

  if (viewport instanceof VideoViewport) {
    return _createVideoViewportCinePlayContext(
      viewport,
      playClipOptions.waitForRendered ?? 30
    );
  }

  throw new Error('Unknown viewport type');
}

export { playClip, stopClip };
