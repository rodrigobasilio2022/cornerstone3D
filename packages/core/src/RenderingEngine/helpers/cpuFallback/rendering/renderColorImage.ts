import now from './now';
import generateColorLUT from './generateColorLUT';
import storedColorPixelDataToCanvasImageData from './storedColorPixelDataToCanvasImageData';
import storedRGBAPixelDataToCanvasImageData from './storedRGBAPixelDataToCanvasImageData';
import setToPixelCoordinateSystem from './setToPixelCoordinateSystem';
import doesImageNeedToBeRendered from './doesImageNeedToBeRendered';
import initializeRenderCanvas from './initializeRenderCanvas';
import saveLastRendered from './saveLastRendered';
import type {
  IImage,
  CPUFallbackViewport,
  CPUFallbackEnabledElement,
} from '../../../../types';
import { createCanvas } from '../../getOrCreateCanvas';

/**
 * Generates an appropriate Look Up Table to render the given image with the given window width and level (specified in the viewport)
 * Uses an internal cache for performance
 *
 * @param {Object} image  The image to be rendered
 * @param {Object} viewport The viewport values used for rendering
 * @returns {Uint8ClampedArray} Look Up Table array.
 * @memberof rendering
 */
function getLut(image: IImage, viewport: CPUFallbackViewport) {
  // If we have a cached lut and it has the right values, return it immediately
  if (
    image.cachedLut !== undefined &&
    image.cachedLut.windowCenter === viewport.voi.windowCenter &&
    image.cachedLut.windowWidth === viewport.voi.windowWidth &&
    image.cachedLut.invert === viewport.invert
  ) {
    return image.cachedLut.lutArray;
  }

  // Lut is invalid or not present, regenerate it and cache it
  generateColorLUT(
    image,
    viewport.voi.windowWidth,
    viewport.voi.windowCenter,
    viewport.invert
  );
  image.cachedLut.windowWidth = viewport.voi.windowWidth;
  image.cachedLut.windowCenter = viewport.voi.windowCenter;
  image.cachedLut.invert = viewport.invert;

  return image.cachedLut.lutArray;
}

/**
 * Returns an appropriate canvas to render the Image. If the canvas available in the cache is appropriate
 * it is returned, otherwise adjustments are made. It also sets the color transfer functions.
 *
 * @param enabledElement - The cornerstone enabled element
 * @param image - The image to be rendered
 * @param invalidated - Is pixel data valid
 * @returns An appropriate canvas for rendering the image
 * @memberof rendering
 */
function getRenderCanvas(
  enabledElement: CPUFallbackEnabledElement,
  image: IImage,
  invalidated: boolean
): HTMLCanvasElement {
  const canvasWasColor = enabledElement.renderingTools.lastRenderedIsColor;

  if (!enabledElement.renderingTools.renderCanvas || !canvasWasColor) {
    enabledElement.renderingTools.renderCanvas = createCanvas(
      null,
      image.width,
      image.height
    ) as unknown as HTMLCanvasElement;
  }

  const renderCanvas = enabledElement.renderingTools.renderCanvas;

  // The ww/wc is identity and not inverted - get a canvas with the image rendered into it for
  // Fast drawing.  Note that this is 256/128, and NOT 255/127, per the DICOM
  // standard, but allow either.
  const { windowWidth, windowCenter } = enabledElement.viewport.voi;
  if (
    (windowWidth === 256 || windowWidth === 255) &&
    (windowCenter === 128 || windowCenter === 127) &&
    !enabledElement.viewport.invert &&
    image.getCanvas &&
    image.getCanvas()
  ) {
    return image.getCanvas();
  }

  // Apply the lut to the stored pixel data onto the render canvas
  if (!doesImageNeedToBeRendered(enabledElement, image) && !invalidated) {
    return renderCanvas;
  }

  // If our render canvas does not match the size of this image reset it
  // NOTE: This might be inefficient if we are updating multiple images of different
  // Sizes frequently.
  if (
    !enabledElement.renderingTools.renderCanvasContext ||
    renderCanvas.width !== image.width ||
    renderCanvas.height !== image.height
  ) {
    initializeRenderCanvas(enabledElement, image);
  }

  // Get the lut to use
  let start = now();
  const colorLUT = getLut(image, enabledElement.viewport);

  image.stats = image.stats || {};
  image.stats.lastLutGenerateTime = now() - start;

  const renderCanvasData = enabledElement.renderingTools.renderCanvasData;
  const renderCanvasContext = enabledElement.renderingTools.renderCanvasContext;

  // The color image voi/invert has been modified - apply the lut to the underlying
  // Pixel data and put it into the renderCanvas
  if (image.rgba) {
    storedRGBAPixelDataToCanvasImageData(
      image,
      colorLUT,
      renderCanvasData.data
    );
  } else {
    storedColorPixelDataToCanvasImageData(
      image,
      colorLUT,
      renderCanvasData.data
    );
  }

  start = now();
  renderCanvasContext.putImageData(renderCanvasData, 0, 0);
  image.stats.lastPutImageDataTime = now() - start;

  return renderCanvas;
}

/**
 * API function to render a color image to an enabled element
 *
 * @param {EnabledElement} enabledElement The Cornerstone Enabled Element to redraw
 * @param {Boolean} invalidated - true if pixel data has been invalidated and cached rendering should not be used
 * @returns {void}
 * @memberof rendering
 */
export function renderColorImage(
  enabledElement: CPUFallbackEnabledElement,
  invalidated: boolean
): void {
  if (enabledElement === undefined) {
    throw new Error(
      'renderColorImage: enabledElement parameter must not be undefined'
    );
  }

  const image = enabledElement.image;

  if (image === undefined) {
    throw new Error(
      'renderColorImage: image must be loaded before it can be drawn'
    );
  }

  // Get the canvas context and reset the transform
  const context = enabledElement.canvas.getContext('2d');

  context.setTransform(1, 0, 0, 1, 0, 0);

  // Clear the canvas
  context.fillStyle = 'black';
  context.fillRect(
    0,
    0,
    enabledElement.canvas.width,
    enabledElement.canvas.height
  );

  // Turn off image smooth/interpolation if pixelReplication is set in the viewport
  context.imageSmoothingEnabled = !enabledElement.viewport.pixelReplication;

  // Save the canvas context state and apply the viewport properties
  setToPixelCoordinateSystem(enabledElement, context);

  const renderCanvas = getRenderCanvas(enabledElement, image, invalidated);

  const sx = enabledElement.viewport.displayedArea.tlhc.x - 1;
  const sy = enabledElement.viewport.displayedArea.tlhc.y - 1;
  const width = enabledElement.viewport.displayedArea.brhc.x - sx;
  const height = enabledElement.viewport.displayedArea.brhc.y - sy;

  context.drawImage(renderCanvas, sx, sy, width, height, 0, 0, width, height);

  enabledElement.renderingTools = saveLastRendered(enabledElement);
}
