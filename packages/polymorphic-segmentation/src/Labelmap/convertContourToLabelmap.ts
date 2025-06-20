import { vec3 } from 'gl-matrix';
import type { Types } from '@cornerstonejs/core';
import {
  cache,
  utilities,
  getWebWorkerManager,
  volumeLoader,
  imageLoader,
  metaData,
  Enums,
  triggerEvent,
  eventTarget,
} from '@cornerstonejs/core';
import type { Types as ToolsTypes } from '@cornerstonejs/tools';
import * as cornerstoneTools from '@cornerstonejs/tools';
import type { PolySegConversionOptions } from '../types';

const { WorkerTypes } = cornerstoneTools.Enums;
const { segmentation } = cornerstoneTools;

const workerManager = getWebWorkerManager();

const triggerWorkerProgress = (eventTarget, progress) => {
  triggerEvent(eventTarget, Enums.Events.WEB_WORKER_PROGRESS, {
    progress,
    type: WorkerTypes.POLYSEG_CONTOUR_TO_LABELMAP,
  });
};

export async function convertContourToVolumeLabelmap(
  contourRepresentationData: ToolsTypes.ContourSegmentationData,
  options: PolySegConversionOptions = {}
) {
  const viewport = options.viewport as Types.IVolumeViewport;
  const volumeId = viewport.getVolumeId();

  const imageIds = utilities.getViewportImageIds(viewport);

  if (!imageIds) {
    throw new Error(
      'No imageIds found, labelmap computation from contour requires viewports with imageIds'
    );
  }

  const segmentationVolumeId = utilities.uuidv4();

  const segmentationVolume = volumeLoader.createAndCacheDerivedLabelmapVolume(
    volumeId,
    {
      volumeId: segmentationVolumeId,
    }
  );

  const { dimensions, origin, direction, spacing, voxelManager } =
    segmentationVolume;

  const { segmentIndices, annotationUIDsInSegmentMap } =
    segmentation.utilities.getAnnotationMapFromSegmentation(
      contourRepresentationData,
      options
    );

  triggerWorkerProgress(eventTarget, 0);

  const newScalarData = await workerManager.executeTask(
    'polySeg',
    'convertContourToVolumeLabelmap',
    {
      segmentIndices,
      dimensions,
      scalarData: voxelManager.getCompleteScalarDataArray?.(),
      origin,
      direction,
      spacing,
      annotationUIDsInSegmentMap,
    },
    {
      callbacks: [
        (progress) => {
          triggerWorkerProgress(eventTarget, progress);
        },
      ],
    }
  );

  triggerWorkerProgress(eventTarget, 100);

  voxelManager.setCompleteScalarDataArray(newScalarData);

  segmentationVolume.modified();

  return {
    volumeId: segmentationVolume.volumeId,
  };
}

export async function convertContourToStackLabelmap(
  contourRepresentationData: ToolsTypes.ContourSegmentationData,
  options: PolySegConversionOptions = {}
) {
  if (!options.viewport) {
    throw new Error(
      'No viewport provided, labelmap computation from contour requires viewports'
    );
  }

  const viewport = options.viewport as Types.IStackViewport;

  const imageIds = viewport.getImageIds();

  if (!imageIds) {
    throw new Error(
      'No imageIds found, labelmap computation from contour requires viewports with imageIds'
    );
  }

  // check if the imageIds are already cached
  imageIds.forEach((imageId) => {
    if (!cache.getImageLoadObject(imageId)) {
      throw new Error(
        'ImageIds must be cached before converting contour to labelmap'
      );
    }
  });

  // create
  const segImages = await imageLoader.createAndCacheDerivedLabelmapImages(
    imageIds
  );

  const segmentationImageIds = segImages.map((it) => it.imageId);

  const { segmentIndices, annotationUIDsInSegmentMap } =
    segmentation.utilities.getAnnotationMapFromSegmentation(
      contourRepresentationData,
      options
    );

  // information for the referenced to the segmentation image
  // Define constant to hold segmentation information
  const segmentationsInfo = new Map();

  // Loop through each segmentation image ID
  segmentationImageIds.forEach((segImageId, index) => {
    // Fetch the image from cache
    const segImage = cache.getImage(segImageId);

    // Fetch metadata for the image
    const imagePlaneModule = metaData.get(
      Enums.MetadataModules.IMAGE_PLANE,
      segImageId
    );

    // Extract properties from image metadata
    let {
      columnCosines,
      rowCosines,
      rowPixelSpacing,
      columnPixelSpacing,
      imagePositionPatient,
    } = imagePlaneModule;

    // Set defaults if necessary
    columnCosines = columnCosines ?? [0, 1, 0];
    rowCosines = rowCosines ?? [1, 0, 0];
    rowPixelSpacing = rowPixelSpacing ?? 1;
    columnPixelSpacing = columnPixelSpacing ?? 1;
    imagePositionPatient = imagePositionPatient ?? [0, 0, 0];

    // Create vector from row and column cosines
    const rowCosineVec = vec3.fromValues(
      rowCosines[0],
      rowCosines[1],
      rowCosines[2]
    );
    const colCosineVec = vec3.fromValues(
      columnCosines[0],
      columnCosines[1],
      columnCosines[2]
    );

    // Calculate scan axis normal
    const scanAxisNormal = vec3.create();
    vec3.cross(scanAxisNormal, rowCosineVec, colCosineVec);

    // Define direction and spacing
    const direction = [...rowCosineVec, ...colCosineVec, ...scanAxisNormal];
    const spacing = [rowPixelSpacing, columnPixelSpacing, 1];

    // Set origin
    const origin = imagePositionPatient;

    // Store segmentation information
    segmentationsInfo.set(imageIds[index], {
      direction,
      spacing,
      origin,
      scalarData: segImage.voxelManager.getScalarData(),
      imageId: segImageId,
      dimensions: [segImage.width, segImage.height, 1],
    });
  });

  triggerWorkerProgress(eventTarget, 0);

  const newSegmentationsScalarData = await workerManager.executeTask(
    'polySeg',
    'convertContourToStackLabelmap',
    {
      segmentationsInfo,
      annotationUIDsInSegmentMap,
      segmentIndices,
    },
    {
      callbacks: [
        (progress) => {
          triggerWorkerProgress(eventTarget, progress);
        },
      ],
    }
  );

  triggerWorkerProgress(eventTarget, 100);

  const segImageIds = [];
  newSegmentationsScalarData.forEach(({ scalarData }, referencedImageId) => {
    const segmentationInfo = segmentationsInfo.get(referencedImageId);
    const { imageId: segImageId } = segmentationInfo;

    const segImage = cache.getImage(segImageId);
    segImage.voxelManager.getScalarData().set(scalarData);
    segImage.imageFrame?.pixelData?.set(scalarData);

    segImageIds.push(segImageId);
  });

  return {
    imageIds: segImageIds,
  };
}
